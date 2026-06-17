"""
Persistent OHLCV cache — SQLite-backed, shared across all data consumers.

Design contract:
  - yfinance is ALWAYS tried first (free, no rate limit on daily bars normally)
  - TwelveData is ONLY called when yfinance fails AND the hard 1-hour cooldown
    since the last TwelveData call has elapsed
  - When TwelveData IS called, it fetches ALL SP500 symbols (batched 8/call,
    rate-limited) in one sweep so every subsequent symbol lookup is a cache hit
  - Data persists in SQLite across server restarts — stale threshold = 6 hours
    (daily bars don't change intraday after market open)

Database schema:
  ohlcv(symbol TEXT, period TEXT, interval TEXT,
         data_json TEXT, source TEXT, fetched_at REAL,
         PRIMARY KEY (symbol, period, interval))

  td_state(id INTEGER PRIMARY KEY CHECK (id=1),
            last_call_at REAL,          -- epoch of last TwelveData API hit
            calls_today  INTEGER,       -- token counter (resets at midnight)
            call_date    TEXT)          -- YYYY-MM-DD for counter reset
"""

import os
import json
import time
import sqlite3
import threading
import logging
from datetime import datetime
from typing import Optional

import pandas as pd
import requests

log = logging.getLogger("ohlcv_store")

# ── Config ────────────────────────────────────────────────────────────────────

# Load .env.local so API keys are available regardless of launch path
_env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
if os.path.exists(_env_path):
    with open(_env_path) as _ef:
        for _el in _ef:
            _el = _el.strip()
            if _el and not _el.startswith("#") and "=" in _el:
                _ek, _ev = _el.split("=", 1)
                os.environ.setdefault(_ek.strip(), _ev.strip())

_DB_PATH      = os.path.join(os.path.dirname(__file__), "ohlcv_cache.db")
_TD_API_KEY   = os.environ.get("TWELVEDATA_API_KEY", "")
_TD_BASE      = "https://api.twelvedata.com"
_TD_COOLDOWN  = 3600      # minimum seconds between any TwelveData API call
_DATA_TTL     = 6 * 3600  # SQLite rows older than 6h are considered stale
_TD_BATCH_SZ  = 8         # TwelveData free tier: 8 req/min
_TD_BATCH_SLP = 61        # sleep between batches (stay under rate limit)

_AV_API_KEY    = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
_AV_BASE       = "https://www.alphavantage.co/query"
# Free tier: 25 calls/day, max 5 calls/min — we enforce conservatively:
# no more than 4 calls/min (one every 15s) and max 20/day
_AV_MIN_INTERVAL = 15.0   # seconds between any two AV calls
_AV_DAY_LIMIT    = 20     # daily cap (leave buffer vs 25 hard limit)

_db_lock = threading.Lock()
_td_fetch_lock = threading.Lock()  # ensures only one TD sweep runs at a time

# Alpha Vantage rate-limit state (in-process, not persisted — resets on restart)
_av_lock          = threading.Lock()
_av_last_call_at  = 0.0
_av_calls_today   = 0
_av_call_date     = ""

# ── SP500 symbols (used for bulk pre-fetch) ───────────────────────────────────
def _load_sp500() -> list[str]:
    try:
        from api.quant.sp500 import SP500_SYMBOLS
        return SP500_SYMBOLS
    except Exception:
        return []


# ── DB init ───────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db_lock:
        conn = _get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ohlcv (
                symbol     TEXT NOT NULL,
                period     TEXT NOT NULL,
                interval_  TEXT NOT NULL,
                data_json  TEXT NOT NULL,
                source     TEXT NOT NULL,
                fetched_at REAL NOT NULL,
                PRIMARY KEY (symbol, period, interval_)
            );
            CREATE TABLE IF NOT EXISTS td_state (
                id           INTEGER PRIMARY KEY CHECK (id = 1),
                last_call_at REAL    NOT NULL DEFAULT 0,
                calls_today  INTEGER NOT NULL DEFAULT 0,
                call_date    TEXT    NOT NULL DEFAULT ''
            );
            INSERT OR IGNORE INTO td_state (id, last_call_at, calls_today, call_date)
            VALUES (1, 0, 0, '');
        """)
        conn.commit()
        conn.close()


_init_db()
# Startup prefetch is triggered at module bottom after all helpers are defined.

# ── TwelveData rate-limit gate ────────────────────────────────────────────────

def _td_cooldown_remaining() -> float:
    """Seconds until TwelveData can be called again (0 = allowed now)."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute("SELECT last_call_at FROM td_state WHERE id=1").fetchone()
        conn.close()
    last = row["last_call_at"] if row else 0
    elapsed = time.time() - last
    return max(0.0, _TD_COOLDOWN - elapsed)


def _td_record_call(n_calls: int = 1) -> None:
    """Record that we just made n_calls TwelveData API calls."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with _db_lock:
        conn = _get_conn()
        row = conn.execute("SELECT calls_today, call_date FROM td_state WHERE id=1").fetchone()
        existing = row["calls_today"] if row and row["call_date"] == today else 0
        conn.execute("""
            UPDATE td_state SET last_call_at=?, calls_today=?, call_date=? WHERE id=1
        """, (time.time(), existing + n_calls, today))
        conn.commit()
        conn.close()
    log.info("TwelveData: %d calls recorded. Total today: %d", n_calls, existing + n_calls)


def get_td_state() -> dict:
    """Return current TwelveData rate-limit state for the status endpoint."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with _db_lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM td_state WHERE id=1").fetchone()
        conn.close()
    if not row:
        return {"last_call_at": 0, "calls_today": 0, "cooldown_remaining": 0}
    calls_today = row["calls_today"] if row["call_date"] == today else 0
    return {
        "last_call_at":       row["last_call_at"],
        "calls_today":        calls_today,
        "cooldown_remaining": round(_td_cooldown_remaining()),
        "cooldown_active":    _td_cooldown_remaining() > 0,
    }


# ── SQLite read/write ─────────────────────────────────────────────────────────

def _db_get(symbol: str, period: str, interval: str) -> Optional[tuple[pd.DataFrame, str]]:
    """Return (df, source) from SQLite if fresh, else None."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT data_json, source, fetched_at FROM ohlcv WHERE symbol=? AND period=? AND interval_=?",
            (symbol, period, interval)
        ).fetchone()
        conn.close()

    if not row:
        return None
    age = time.time() - row["fetched_at"]
    if age > _DATA_TTL:
        return None  # stale — let caller re-fetch

    try:
        records = json.loads(row["data_json"])
        df = pd.DataFrame(records)
        df.index = pd.to_datetime(df.pop("_date"))
        df.index.name = "Date"
        return df, row["source"]
    except Exception:
        return None


def _db_put(symbol: str, period: str, interval: str, df: pd.DataFrame, source: str) -> None:
    """Persist a DataFrame to SQLite."""
    if df.empty:
        return
    records = df.copy()
    records["_date"] = records.index.strftime("%Y-%m-%d")
    data_json = records.to_dict(orient="records")
    with _db_lock:
        conn = _get_conn()
        conn.execute("""
            INSERT OR REPLACE INTO ohlcv (symbol, period, interval_, data_json, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (symbol, period, interval, json.dumps(data_json), source, time.time()))
        conn.commit()
        conn.close()


def _db_put_many(items: list[tuple[str, pd.DataFrame]], period: str, interval: str, source: str) -> None:
    """Batch-persist multiple (symbol, df) pairs."""
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    rows = []
    for symbol, df in items:
        if df.empty:
            continue
        try:
            records = df.copy()
            records["_date"] = records.index.strftime("%Y-%m-%d")
            data_json = json.dumps(records.to_dict(orient="records"))
            rows.append((symbol, period, interval, data_json, source, time.time()))
        except Exception as e:
            log.warning("_db_put_many %s: %s", symbol, e)

    if not rows:
        return

    with _db_lock:
        conn = _get_conn()
        conn.executemany("""
            INSERT OR REPLACE INTO ohlcv (symbol, period, interval_, data_json, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, rows)
        conn.commit()
        conn.close()
    log.info("Stored %d OHLCV series to SQLite", len(rows))


# ── TwelveData batch OHLCV fetch ─────────────────────────────────────────────

def _td_fetch_one(symbol: str, outputsize: int) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV for one symbol from TwelveData."""
    try:
        resp = requests.get(
            f"{_TD_BASE}/time_series",
            params={
                "symbol":     symbol,
                "interval":   "1day",
                "outputsize": min(outputsize, 5000),
                "apikey":     _TD_API_KEY,
                "format":     "JSON",
            },
            timeout=20,
        )
        data = resp.json()
        if data.get("status") == "error" or "values" not in data:
            log.warning("TwelveData %s: %s", symbol, data.get("message", "no values"))
            return None

        values = list(reversed(data["values"]))
        rows, dates = [], []
        for v in values:
            try:
                rows.append({
                    "Open":   float(v["open"]),
                    "High":   float(v["high"]),
                    "Low":    float(v["low"]),
                    "Close":  float(v["close"]),
                    "Volume": int(float(v.get("volume", 0))),
                })
                dates.append(v["datetime"])
            except (KeyError, ValueError):
                continue

        if not rows:
            return None

        df = pd.DataFrame(rows, index=pd.to_datetime(dates))
        df.index.name = "Date"
        return df
    except Exception as e:
        log.warning("TwelveData fetch %s: %s", symbol, e)
        return None


def _td_bulk_fetch_all_sp500(period: str = "1y") -> int:
    """
    Fetch TwelveData OHLCV for ALL SP500 symbols and store in SQLite.
    Rate-limited: 8 calls/min → batch 8, sleep 61s between batches.
    Returns number of symbols successfully fetched.
    """
    symbols = _load_sp500()
    if not symbols:
        return 0

    outputsize = _period_to_outputsize(period)
    ok = 0
    api_calls = 0

    for batch_start in range(0, len(symbols), _TD_BATCH_SZ):
        batch = symbols[batch_start: batch_start + _TD_BATCH_SZ]
        results: list[tuple[str, pd.DataFrame]] = []

        for sym in batch:
            df = _td_fetch_one(sym, outputsize)
            api_calls += 1
            if df is not None:
                results.append((sym, df))

        _td_record_call(len(batch))
        _db_put_many(results, period, "1d", "twelvedata")
        ok += len(results)

        log.info("TD bulk fetch: %d/%d done (%d ok)", batch_start + len(batch), len(symbols), ok)

        if batch_start + _TD_BATCH_SZ < len(symbols):
            time.sleep(_TD_BATCH_SLP)

    return ok


def _period_to_outputsize(period: str) -> int:
    return {
        "1d": 1, "5d": 5, "1mo": 22, "3mo": 65,
        "6mo": 130, "1y": 252, "2y": 504, "5y": 1260, "max": 5000,
    }.get(period, 252)


# ── yfinance helpers ──────────────────────────────────────────────────────────

_yf_batch_lock = threading.Lock()   # one batch download at a time
_yf_prefetch_done = False           # set True after first startup sweep


def _clean_yf_df(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise a single-symbol yfinance DataFrame to OHLCV with Date index."""
    df = df.copy()
    # yf.download multi-symbol returns MultiIndex columns (field, symbol);
    # single-symbol returns flat columns — handle both
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns={"Adj Close": "Close"}) if "Adj Close" in df.columns and "Close" not in df.columns else df
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col not in df.columns:
            return pd.DataFrame()
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df[df["Close"] > 0]
    df = df[df["Volume"] >= 0]
    df = df.ffill(limit=3).dropna(subset=["Close", "Volume"])
    df.index.name = "Date"
    return df


def _yf_batch_download(symbols: list[str], period: str, interval: str) -> dict[str, pd.DataFrame]:
    """
    Download multiple symbols in a single yf.download() call.
    Returns {symbol: df} for successfully fetched symbols.
    yf.download batches all tickers into one HTTP request — avoids per-ticker throttling.
    """
    if not symbols:
        return {}
    try:
        import yfinance as yf
        raw = yf.download(
            tickers=symbols,
            period=period,
            interval=interval,
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        if raw.empty:
            return {}

        result: dict[str, pd.DataFrame] = {}

        if len(symbols) == 1:
            # Single symbol: flat columns
            df = _clean_yf_df(raw)
            if not df.empty:
                result[symbols[0].upper()] = df
        else:
            # Multi symbol: top-level columns are symbols
            for sym in symbols:
                try:
                    sym_u = sym.upper()
                    if sym_u not in raw.columns.get_level_values(0):
                        continue
                    df = raw[sym_u].copy()
                    df = _clean_yf_df(df)
                    if not df.empty:
                        result[sym_u] = df
                except Exception as e:
                    log.debug("yf batch parse %s: %s", sym, e)

        return result
    except Exception as e:
        log.warning("yf batch download error (%d syms): %s", len(symbols), type(e).__name__)
        return {}


def _yf_fetch(symbol: str, period: str, interval: str) -> Optional[pd.DataFrame]:
    """Single-symbol fetch — tries batch download first, falls back to Ticker.history."""
    result = _yf_batch_download([symbol], period, interval)
    if result:
        return result.get(symbol.upper())
    # Fallback: direct Ticker (may rate-limit for heavy use)
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        if df.empty:
            return None
        return _clean_yf_df(df) or None
    except Exception as e:
        log.warning("yfinance %s: %s", symbol, type(e).__name__)
        return None


def _yf_csv_fetch(symbol: str, period: str) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV by hitting Yahoo Finance's CSV download endpoint directly with
    a browser User-Agent. This is a separate HTTP session from the yfinance
    library — it uses different cookies/headers and doesn't share the rate-limit
    bucket that throttles per-library sessions.
    """
    try:
        import io
        from datetime import datetime, timezone
        now_ts = int(datetime.now(timezone.utc).timestamp())
        days = int(_period_to_outputsize(period) * 1.6)  # buffer for weekends
        start_ts = now_ts - days * 86400

        url = (
            f"https://query1.finance.yahoo.com/v7/finance/download/{symbol}"
            f"?period1={start_ts}&period2={now_ts}&interval=1d"
            f"&events=history&includeAdjustedClose=true"
        )
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code != 200:
            log.debug("yf_csv %s HTTP %s", symbol, resp.status_code)
            return None

        df = pd.read_csv(io.StringIO(resp.text))
        if df.empty or "Close" not in df.columns:
            return None

        df = df.rename(columns={"Adj Close": "Close"}) if "Adj Close" in df.columns and "Close" not in df.columns else df
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.set_index("Date")
        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
        df = df[df["Close"] > 0].dropna(subset=["Close"])
        df.index.name = "Date"
        return df if not df.empty else None

    except Exception as e:
        log.debug("yf_csv %s: %s", symbol, type(e).__name__)
        return None


def _av_fetch(symbol: str, period: str) -> Optional[pd.DataFrame]:
    """
    Fetch daily OHLCV from Alpha Vantage TIME_SERIES_DAILY (free tier).
    Rate-limited to _AV_MIN_INTERVAL seconds between calls and _AV_DAY_LIMIT/day.
    Used as Tier 3.5 fallback when yfinance batch and direct fail.
    """
    global _av_last_call_at, _av_calls_today, _av_call_date

    if not _AV_API_KEY:
        return None

    today = datetime.utcnow().strftime("%Y-%m-%d")

    with _av_lock:
        # Reset daily counter at midnight
        if _av_call_date != today:
            _av_calls_today = 0
            _av_call_date = today

        if _av_calls_today >= _AV_DAY_LIMIT:
            log.debug("AV daily cap reached (%d/%d)", _av_calls_today, _AV_DAY_LIMIT)
            return None

        # Enforce minimum interval between calls
        elapsed = time.time() - _av_last_call_at
        if elapsed < _AV_MIN_INTERVAL:
            wait = _AV_MIN_INTERVAL - elapsed
            log.debug("AV rate-limit: sleeping %.1fs", wait)
            time.sleep(wait)

        _av_last_call_at = time.time()
        _av_calls_today += 1
        call_num = _av_calls_today

    log.info("Alpha Vantage fetch %s (call %d/%d today)", symbol, call_num, _AV_DAY_LIMIT)

    try:
        # compact = last 100 bars (free); full = 20+ years (also free for TIME_SERIES_DAILY)
        outputsize = "compact" if _period_to_outputsize(period) <= 100 else "full"
        resp = requests.get(
            _AV_BASE,
            params={
                "function":   "TIME_SERIES_DAILY",
                "symbol":     symbol,
                "outputsize": outputsize,
                "datatype":   "json",
                "apikey":     _AV_API_KEY,
            },
            timeout=20,
        )
        data = resp.json()

        # AV returns rate-limit note in "Information" or "Note" key
        if "Information" in data or "Note" in data:
            msg = data.get("Information") or data.get("Note", "")
            log.warning("AV rate limit response for %s: %s", symbol, msg[:120])
            with _av_lock:
                _av_calls_today = _AV_DAY_LIMIT  # block further calls this session
            return None

        ts = data.get("Time Series (Daily)")
        if not ts:
            log.debug("AV no time series for %s: %s", symbol, list(data.keys()))
            return None

        rows, dates = [], []
        for date_str, v in sorted(ts.items()):
            try:
                rows.append({
                    "Open":   float(v["1. open"]),
                    "High":   float(v["2. high"]),
                    "Low":    float(v["3. low"]),
                    "Close":  float(v["4. close"]),
                    "Volume": int(float(v.get("5. volume", 0))),
                })
                dates.append(date_str)
            except (KeyError, ValueError):
                continue

        if not rows:
            return None

        df = pd.DataFrame(rows, index=pd.to_datetime(dates))
        df.index.name = "Date"
        df = df[df["Close"] > 0].dropna(subset=["Close"])
        return df if not df.empty else None

    except Exception as e:
        log.warning("AV fetch %s: %s", symbol, type(e).__name__)
        return None


def _yf_prefetch_top_symbols(symbols: list[str], period: str = "1y", interval: str = "1d",
                              batch_size: int = 100) -> int:
    """
    Background batch-download symbols into SQLite using yf.download().
    Processes in batches of `batch_size` (yfinance handles ~200 fine).
    Skips symbols already fresh in SQLite.
    Returns count of symbols stored.
    """
    to_fetch = [s for s in symbols if _db_get(s, period, interval) is None]
    if not to_fetch:
        log.info("yf prefetch: all %d symbols already cached", len(symbols))
        return 0

    log.info("yf prefetch: downloading %d symbols in batches of %d", len(to_fetch), batch_size)
    stored = 0

    for i in range(0, len(to_fetch), batch_size):
        batch = to_fetch[i: i + batch_size]
        with _yf_batch_lock:
            fetched = _yf_batch_download(batch, period, interval)

        items = [(sym, df) for sym, df in fetched.items()]
        _db_put_many(items, period, interval, "yfinance")
        stored += len(items)
        log.info("yf prefetch batch %d/%d: %d/%d ok",
                 i // batch_size + 1, (len(to_fetch) + batch_size - 1) // batch_size,
                 len(items), len(batch))
        # Brief pause between large batches to be a good citizen
        if i + batch_size < len(to_fetch):
            time.sleep(2)

    log.info("yf prefetch complete: %d symbols stored", stored)
    return stored


# ── Startup background prefetch ───────────────────────────────────────────────

def _start_background_prefetch(period: str = "1y") -> None:
    """
    Called once on module import. Runs yf.download() for top SP500 symbols
    in a daemon thread so the server is ready instantly and the cache fills
    in the background without blocking any request.
    """
    global _yf_prefetch_done
    if _yf_prefetch_done:
        return
    _yf_prefetch_done = True

    def _run():
        symbols = _load_sp500()
        if not symbols:
            return
        log.info("Background yf prefetch starting for %d SP500 symbols", len(symbols))
        n = _yf_prefetch_top_symbols(symbols, period=period)
        log.info("Background yf prefetch finished: %d symbols cached", n)

    t = threading.Thread(target=_run, daemon=True, name="yf-prefetch")
    t.start()


# ── Public fetch API ──────────────────────────────────────────────────────────

# In-memory hot cache on top of SQLite (avoids JSON parse overhead)
_hot_cache: dict[str, tuple[pd.DataFrame, str, float]] = {}
_hot_lock = threading.Lock()
_HOT_TTL = 600  # 10 minutes — must outlive the Render prewarm window


def fetch(symbol: str, period: str = "1y", interval: str = "1d") -> tuple[pd.DataFrame, str]:
    """
    Fetch OHLCV with a four-tier hierarchy:
      1. In-memory hot cache (60s TTL)
      2. SQLite persistent cache (6h TTL)
      3. yfinance batch download (all SP500 in one HTTP call) → stored in SQLite
      4. TwelveData bulk fetch (ALL SP500) → stored in SQLite
         ONLY if: yfinance is rate-limited AND TD cooldown has elapsed

    Returns (DataFrame, source).
    """
    sym = symbol.upper()
    hot_key = f"{sym}|{period}|{interval}"

    # ── Tier 1: hot memory cache ──
    with _hot_lock:
        entry = _hot_cache.get(hot_key)
        if entry and (time.time() - entry[2]) < _HOT_TTL:
            return entry[0].copy(), "memory_cache"

    # ── Tier 2: SQLite persistent cache ──
    cached = _db_get(sym, period, interval)
    if cached is not None:
        df, source = cached
        with _hot_lock:
            _hot_cache[hot_key] = (df, source, time.time())
        return df.copy(), f"sqlite_{source}"

    # ── Tier 3: yfinance batch download ──
    # Fetch sym + a window of SP500 symbols together in one HTTP call so
    # subsequent lookups are SQLite hits — avoids per-ticker throttling.
    batch_hit = False
    if interval == "1d":
        sp500 = _load_sp500()
        # Build a batch: the requested symbol + up to 99 uncached SP500 peers
        uncached = [s for s in sp500 if s != sym and _db_get(s, period, interval) is None]
        batch = [sym] + uncached[:99]  # max 100 per download call
        with _yf_batch_lock:
            fetched = _yf_batch_download(batch, period, interval)

        if fetched:
            items = [(s, df) for s, df in fetched.items()]
            _db_put_many(items, period, interval, "yfinance")
            # Warm hot cache for all fetched symbols
            with _hot_lock:
                for s, df in fetched.items():
                    _hot_cache[f"{s}|{period}|{interval}"] = (df, "yfinance", time.time())

            if sym in fetched:
                return fetched[sym].copy(), "yfinance"
            batch_hit = True  # batch ran but sym wasn't in result

    # Single-symbol yfinance fallback (non-daily intervals or batch missed the symbol)
    if not batch_hit:
        df = _yf_fetch(sym, period, interval)
        if df is not None and not df.empty:
            _db_put(sym, period, interval, df, "yfinance")
            with _hot_lock:
                _hot_cache[hot_key] = (df, "yfinance", time.time())
            return df.copy(), "yfinance"

    # ── Tier 3.5: Alpha Vantage (rate-limited: 20 calls/day, 1 per 15s) ──────
    if interval == "1d" and _AV_API_KEY:
        df = _av_fetch(sym, period)
        if df is not None and not df.empty:
            _db_put(sym, period, interval, df, "alphavantage")
            with _hot_lock:
                _hot_cache[hot_key] = (df, "alphavantage", time.time())
            log.info("AlphaVantage hit for %s", sym)
            return df.copy(), "alphavantage"

    # ── Tier 4: TwelveData bulk fetch (guarded by cooldown) ──
    if interval != "1d" or not _TD_API_KEY:
        return pd.DataFrame(), "none"

    cooldown = _td_cooldown_remaining()
    if cooldown > 0:
        log.info("TwelveData cooldown active (%.0fs remaining) — no data for %s", cooldown, sym)
        return pd.DataFrame(), "none"

    # Acquire lock so only ONE bulk sweep runs at a time
    acquired = _td_fetch_lock.acquire(blocking=False)
    if not acquired:
        log.info("TwelveData sweep already running — waiting for %s", sym)
        _td_fetch_lock.acquire(blocking=True)
        _td_fetch_lock.release()
        cached = _db_get(sym, period, interval)
        if cached:
            df, source = cached
            with _hot_lock:
                _hot_cache[hot_key] = (df, source, time.time())
            return df.copy(), f"sqlite_{source}"
        return pd.DataFrame(), "none"

    try:
        log.info("TwelveData bulk sweep starting for period=%s", period)
        n = _td_bulk_fetch_all_sp500(period)
        log.info("TwelveData bulk sweep done: %d symbols stored", n)
    finally:
        _td_fetch_lock.release()

    cached = _db_get(sym, period, interval)
    if cached:
        df, source = cached
        with _hot_lock:
            _hot_cache[hot_key] = (df, source, time.time())
        return df.copy(), f"sqlite_{source}"

    return pd.DataFrame(), "none"


def td_bulk_sweep_now(period: str = "1y", force: bool = False) -> dict:
    """
    Explicitly trigger a TwelveData bulk SP500 sweep.
    If force=True, bypasses the 1-hour cooldown (use only when yfinance is fully down).
    Returns status dict.
    """
    if not _TD_API_KEY:
        return {"ok": False, "error": "No TwelveData API key configured"}

    cooldown = _td_cooldown_remaining()
    if cooldown > 0 and not force:
        return {"ok": False, "cooldown_remaining": round(cooldown), "error": "Cooldown active"}

    acquired = _td_fetch_lock.acquire(blocking=False)
    if not acquired:
        return {"ok": False, "error": "Sweep already running"}

    try:
        log.info("TD bulk sweep (force=%s) starting for period=%s", force, period)
        n = _td_bulk_fetch_all_sp500(period)
        log.info("TD bulk sweep done: %d symbols stored", n)
        return {"ok": True, "symbols_stored": n, "period": period}
    finally:
        _td_fetch_lock.release()


def fetch_quote_with_source(symbol: str) -> tuple[dict, str]:
    """
    Live quote. yfinance primary, OHLCV SQLite cache fallback.
    TwelveData is NEVER called here — it is reserved exclusively for bulk OHLCV sweeps.
    Returns (quote_dict, source).
    """
    sym = symbol.upper()
    source = "yfinance"
    result: dict = {"symbol": sym, "price": 0, "change_pct": 0, "volume": 0, "market_cap": 0}

    try:
        import yfinance as yf
        info = yf.Ticker(sym).fast_info
        price = float(info.last_price or 0)
        prev  = float(info.previous_close or price)
        if price > 0:
            result = {
                "symbol":     sym,
                "price":      round(price, 4),
                "prev_close": round(prev, 4),
                "change_pct": round((price / max(prev, 1e-8) - 1) * 100, 3),
                "volume":     int(info.three_month_average_volume or 0),
                "market_cap": float(getattr(info, "market_cap", 0) or 0),
            }
            return result, source
    except Exception:
        pass

    # Last-resort: derive quote from cached OHLCV (last two rows)
    cached = _db_get(sym, "1y", "1d") or _db_get(sym, "6mo", "1d")
    if cached is not None:
        df, ohlcv_source = cached
        if len(df) >= 2:
            price = float(df["Close"].iloc[-1])
            prev  = float(df["Close"].iloc[-2])
            result = {
                "symbol":     sym,
                "price":      round(price, 4),
                "prev_close": round(prev, 4),
                "change_pct": round((price / max(prev, 1e-8) - 1) * 100, 3),
                "volume":     int(df["Volume"].iloc[-1]),
                "market_cap": 0,
            }
            source = f"sqlite_{ohlcv_source}"
        elif len(df) == 1:
            price = float(df["Close"].iloc[-1])
            result = {"symbol": sym, "price": round(price, 4), "prev_close": round(price, 4),
                      "change_pct": 0.0, "volume": int(df["Volume"].iloc[-1]), "market_cap": 0}
            source = f"sqlite_{ohlcv_source}"

    return result, source


# ── Module startup: kick off background yfinance prefetch ─────────────────────
_start_background_prefetch(period="1y")
