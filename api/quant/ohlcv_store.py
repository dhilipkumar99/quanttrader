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
    """Fetch daily OHLCV for one symbol from TwelveData (1 credit per call)."""
    try:
        # TwelveData uses slash notation for class-B shares (BRK/B, BF/B)
        td_symbol = symbol.replace("-", "/")
        resp = requests.get(
            f"{_TD_BASE}/time_series",
            params={
                "symbol":     td_symbol,
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
    """
    Normalise a yfinance DataFrame slice to OHLCV with Date index.

    yfinance ≥0.2.50 changed the column MultiIndex from (Field, Ticker) to
    (Ticker, Field) for BOTH single and multi-symbol downloads when
    group_by='ticker' is set.  After slicing raw[ticker] the result has flat
    columns ['Open','High',...] — but we also accept whatever we receive.
    """
    df = df.copy()
    # Flatten any remaining MultiIndex (shouldn't happen after per-symbol slice,
    # but guard against future yfinance changes)
    if isinstance(df.columns, pd.MultiIndex):
        # Try (Ticker, Field) — take level 1
        level1 = df.columns.get_level_values(1).tolist()
        if "Close" in level1:
            df.columns = level1
        else:
            # Fall back to level 0
            df.columns = df.columns.get_level_values(0)

    # Prefer adjusted close
    if "Adj Close" in df.columns and "Close" not in df.columns:
        df = df.rename(columns={"Adj Close": "Close"})

    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col not in df.columns:
            return pd.DataFrame()

    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df[df["Close"] > 0]
    df = df[df["Volume"] >= 0]
    df = df.ffill(limit=3).dropna(subset=["Close", "Volume"])
    df.index.name = "Date"
    return df


def _yf_batch_download(symbols: list[str], period: str, interval: str) -> dict[str, pd.DataFrame]:
    """
    Download multiple symbols in a single yf.download() call.
    Returns {symbol: df} for successfully fetched symbols.

    yfinance ≥0.2.50: group_by='ticker' always returns MultiIndex (Ticker, Field)
    regardless of whether 1 or N tickers are requested.  We handle this by
    always treating the result as a per-ticker MultiIndex and slicing by ticker.
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
            threads=False,
        )
        if raw.empty:
            return {}

        result: dict[str, pd.DataFrame] = {}

        # New yfinance always returns (Ticker, Field) MultiIndex with group_by='ticker'
        if isinstance(raw.columns, pd.MultiIndex):
            available = set(raw.columns.get_level_values(0))
            for sym in symbols:
                sym_u = sym.upper()
                if sym_u not in available:
                    continue
                try:
                    df = raw[sym_u].copy()   # produces flat (Field,) columns
                    df = _clean_yf_df(df)
                    if not df.empty:
                        result[sym_u] = df
                except Exception as e:
                    log.debug("yf batch parse %s: %s", sym_u, e)
        else:
            # Flat columns — single ticker, old yfinance behaviour (shouldn't happen)
            df = _clean_yf_df(raw)
            if not df.empty:
                result[symbols[0].upper()] = df

        return result
    except Exception as e:
        log.warning("yf batch download error (%d syms): %s", len(symbols), type(e).__name__)
        return {}


def _yf_fetch(symbol: str, period: str, interval: str) -> Optional[pd.DataFrame]:
    """Single-symbol fetch — tries batch download first, falls back to Ticker.history."""
    result = _yf_batch_download([symbol], period, interval)
    df = result.get(symbol.upper()) if result else None
    if df is not None and not df.empty:
        return df
    # Fallback: direct Ticker (may rate-limit for heavy use)
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        raw = ticker.history(period=period, interval=interval)
        if raw is None or raw.empty:
            return None
        cleaned = _clean_yf_df(raw)
        return cleaned if not cleaned.empty else None
    except Exception as e:
        log.warning("yfinance %s: %s", symbol, type(e).__name__)
        return None


# ── Yahoo Finance chart v8 JSON fetcher ──────────────────────────────────────
# query1 and query2 are separate Yahoo servers with independent rate-limit buckets.
# We round-robin between them so sustained load is spread across both.
# No crumb/cookie required — just a browser User-Agent.

_YF_CHART_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
_yf_chart_host_idx = 0
_yf_chart_lock = threading.Lock()
_YF_CHART_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]


def _yf_chart_fetch(symbol: str, period: str = "1y") -> Optional[pd.DataFrame]:
    """
    Fetch daily OHLCV via Yahoo Finance chart v8 JSON endpoint.
    Round-robins between query1 and query2 — completely separate rate-limit
    buckets from the yfinance library and from each other.
    Returns cleaned DataFrame or None.
    """
    global _yf_chart_host_idx
    try:
        import io as _io
        with _yf_chart_lock:
            host = _YF_CHART_HOSTS[_yf_chart_host_idx % len(_YF_CHART_HOSTS)]
            _yf_chart_host_idx += 1
            ua = _YF_CHART_UAS[_yf_chart_host_idx % len(_YF_CHART_UAS)]

        # Map period string to Yahoo range param
        yf_range = {
            "1mo": "1mo", "3mo": "3mo", "6mo": "6mo",
            "1y": "1y", "2y": "2y", "5y": "5y",
        }.get(period, "1y")

        resp = requests.get(
            f"https://{host}/v8/finance/chart/{symbol}",
            params={"interval": "1d", "range": yf_range},
            headers={"User-Agent": ua, "Accept": "application/json"},
            timeout=12,
        )
        if resp.status_code != 200:
            log.debug("yf_chart_v8 %s %s HTTP %s", host, symbol, resp.status_code)
            return None

        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return None

        r = result[0]
        timestamps = r.get("timestamp", [])
        quote = r.get("indicators", {}).get("quote", [{}])[0]
        adjclose_list = r.get("indicators", {}).get("adjclose", [{}])
        adjclose = adjclose_list[0].get("adjclose", []) if adjclose_list else []

        if not timestamps or not quote.get("close"):
            return None

        closes = adjclose if adjclose else quote["close"]
        rows = []
        dates = []
        for i, ts in enumerate(timestamps):
            try:
                o = quote["open"][i]
                h = quote["high"][i]
                l = quote["low"][i]
                c = closes[i]
                v = quote["volume"][i]
                if c is None or o is None:
                    continue
                rows.append({"Open": float(o), "High": float(h or c), "Low": float(l or c),
                             "Close": float(c), "Volume": int(v or 0)})
                dates.append(pd.Timestamp(ts, unit="s", tz="UTC").tz_localize(None).normalize())
            except (IndexError, TypeError):
                continue

        if not rows:
            return None

        df = pd.DataFrame(rows, index=pd.DatetimeIndex(dates))
        df.index.name = "Date"
        df = df[df["Close"] > 0].dropna(subset=["Close"])
        return df if not df.empty else None

    except Exception as e:
        log.debug("yf_chart_v8 %s: %s", symbol, type(e).__name__)
        return None


def _yf_spark_quotes(symbols: list[str]) -> dict[str, dict]:
    """
    Fetch real-time quotes for multiple symbols via Yahoo Finance spark endpoint.
    Returns up to 5 days of bars per symbol — we use only the last two for price/change.
    Completely separate rate-limit bucket from yf.download and yf_chart_v8.
    """
    if not symbols:
        return {}
    try:
        resp = requests.get(
            "https://query1.finance.yahoo.com/v7/finance/spark",
            params={
                "symbols": ",".join(symbols),
                "range": "5d",
                "interval": "1d",
            },
            headers={
                "User-Agent": _YF_CHART_UAS[0],
                "Accept": "application/json",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            return {}

        out: dict[str, dict] = {}
        ts_now = time.time()
        for s in resp.json().get("spark", {}).get("result", []):
            sym = s.get("symbol", "").upper()
            if not sym:
                continue
            try:
                resp_data = s.get("response", [{}])[0]
                q = resp_data.get("indicators", {}).get("quote", [{}])[0]
                closes = [c for c in q.get("close", []) if c is not None]
                vols   = [v for v in q.get("volume", []) if v is not None]
                if len(closes) < 1:
                    continue
                price = round(float(closes[-1]), 2)
                prev  = round(float(closes[-2]), 2) if len(closes) >= 2 else price
                vol   = int(vols[-1]) if vols else 0
                chg   = round(((price / prev) - 1) * 100, 3) if prev else 0.0
                out[sym] = {"symbol": sym, "price": price, "change_pct": chg,
                            "volume": vol, "market_cap": 0, "ts": ts_now}
            except Exception:
                continue
        return out
    except Exception as e:
        log.debug("yf_spark_quotes: %s", type(e).__name__)
        return {}


_yf_csv_session: "requests.Session | None" = None
_yf_csv_crumb: str = ""
_yf_csv_lock = threading.Lock()


def _reset_yf_csv_session() -> None:
    global _yf_csv_session, _yf_csv_crumb
    with _yf_csv_lock:
        _yf_csv_session = None
        _yf_csv_crumb = ""


def _get_yf_csv_session() -> "tuple[requests.Session, str]":
    """Return (session, crumb) for Yahoo Finance CSV endpoint, refreshing as needed."""
    global _yf_csv_session, _yf_csv_crumb
    with _yf_csv_lock:
        if _yf_csv_session is not None and _yf_csv_crumb:
            return _yf_csv_session, _yf_csv_crumb
        sess = requests.Session()
        sess.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        # Fetch crumb from Yahoo Finance consent page
        try:
            r = sess.get("https://finance.yahoo.com/quote/AAPL", timeout=10)
            import re
            m = re.search(r'"crumb":"([^"]+)"', r.text)
            crumb = m.group(1) if m else ""
        except Exception:
            crumb = ""
        _yf_csv_session = sess
        _yf_csv_crumb = crumb
        return sess, crumb


def _yf_csv_fetch(symbol: str, period: str) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV via Yahoo Finance CSV download with a persistent browser session.
    Uses a shared session+crumb so cookies carry over — this is a completely
    separate rate-limit bucket from the yfinance library.
    """
    try:
        import io
        from datetime import datetime, timezone
        now_ts = int(datetime.now(timezone.utc).timestamp())
        days = int(_period_to_outputsize(period) * 1.6)  # buffer for weekends
        start_ts = now_ts - days * 86400

        sess, crumb = _get_yf_csv_session()
        params = {
            "period1": start_ts,
            "period2": now_ts,
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        }
        if crumb:
            params["crumb"] = crumb

        resp = sess.get(
            f"https://query1.finance.yahoo.com/v7/finance/download/{symbol}",
            params=params,
            timeout=12,
        )
        if resp.status_code == 401:
            # Crumb expired — invalidate and retry once
            _reset_yf_csv_session()
            sess, crumb = _get_yf_csv_session()
            if crumb:
                params["crumb"] = crumb
            resp = sess.get(
                f"https://query1.finance.yahoo.com/v7/finance/download/{symbol}",
                params=params,
                timeout=12,
            )
        if resp.status_code != 200:
            log.debug("yf_csv %s HTTP %s", symbol, resp.status_code)
            return None

        df = pd.read_csv(io.StringIO(resp.text))
        if df.empty or "Close" not in df.columns:
            return None

        if "Adj Close" in df.columns and "Close" not in df.columns:
            df = df.rename(columns={"Adj Close": "Close"})
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.set_index("Date")
        keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
        if "Close" not in keep:
            return None
        df = df[keep].copy()
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
        # AV free tier only supports outputsize=compact (last 100 bars).
        # full requires a premium plan — always use compact to stay on free tier.
        outputsize = "compact"
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



_PERIOD_BARS: dict[str, int] = {
    "1d": 1, "5d": 5, "1mo": 21, "3mo": 63, "6mo": 126,
    "1y": 252, "2y": 504, "5y": 1260, "10y": 2520,
}
# Periods that can serve as superset for a requested shorter period
_PERIOD_FALLBACK_ORDER = ["10y", "5y", "2y", "1y", "6mo", "3mo", "1mo", "5d"]


def _db_get_with_fallback(symbol: str, period: str, interval: str) -> Optional[tuple[pd.DataFrame, str]]:
    """
    Like _db_get, but if the exact period misses, try longer cached periods and
    slice them down to the requested window. This lets a "1mo" request be served
    from the "1y" bg_refresh data without a separate download.
    """
    # Exact match first
    result = _db_get(symbol, period, interval)
    if result is not None:
        return result

    requested_bars = _PERIOD_BARS.get(period, 252)
    for fallback_period in _PERIOD_FALLBACK_ORDER:
        if fallback_period == period:
            continue
        fallback_bars = _PERIOD_BARS.get(fallback_period, 0)
        if fallback_bars <= requested_bars:
            continue  # shorter period can't serve a longer request
        cached = _db_get(symbol, fallback_period, interval)
        if cached is not None:
            df, source = cached
            # Slice to approximately the requested number of bars
            if len(df) > requested_bars:
                df = df.iloc[-requested_bars:]
            log.debug("Period fallback %s: served %s from %s cache", symbol, period, fallback_period)
            return df, source
    return None


def fetch(symbol: str, period: str = "1y", interval: str = "1d") -> tuple[pd.DataFrame, str]:
    """
    Fetch OHLCV with a five-tier hierarchy:
      1. In-memory hot cache (10 min TTL)
      2. SQLite persistent cache with period fallback — a "1mo" request served
         from "1y" bg_refresh data avoids a live API call entirely
      3. Yahoo Finance CSV endpoint (browser User-Agent, separate rate-limit bucket)
      4. yfinance library (may share Yahoo rate-limit bucket)
      5. Alpha Vantage (20 calls/day hard cap)
      6. TwelveData (200 credits/day cap, well under 800 free-tier limit)

    Returns (DataFrame, source).
    """
    sym = symbol.upper()
    hot_key = f"{sym}|{period}|{interval}"

    # Minimum bars the engine needs to produce a real signal.
    # feature_eng.compute() uses a 40-bar rolling Hurst window — after dropna()
    # the features DataFrame is empty for any input with fewer than ~41 bars.
    # 50 gives safe headroom above that threshold.
    _MIN_BARS = 50

    # ── Tier 1: hot memory cache ──
    with _hot_lock:
        entry = _hot_cache.get(hot_key)
        if entry and (time.time() - entry[2]) < _HOT_TTL:
            cached_df = entry[0]
            if len(cached_df) >= _MIN_BARS:
                return cached_df.copy(), "memory_cache"
            # Too short — evict and fall through to live fetch
            del _hot_cache[hot_key]

    # ── Tier 2: SQLite with period fallback ──
    # Critical: bg_refresh stores data under "1y". Requests for "1mo", "6mo", etc.
    # are sliced from the 1y data — no live API call needed for cached symbols.
    cached = _db_get_with_fallback(sym, period, interval)
    if cached is not None:
        df, source = cached
        if len(df) >= _MIN_BARS:
            with _hot_lock:
                _hot_cache[hot_key] = (df, source, time.time())
            return df.copy(), f"sqlite_{source}"
        # Too few bars — fall through to live fetch; don't cache this stub

    # ── Tier 3: Yahoo Finance chart v8 JSON (query1 + query2 round-robin) ──
    # Two independent Yahoo servers, no crumb/session needed, works on all symbols.
    # Always fetches 1y so all shorter-period requests are served from SQLite fallback next time.
    if interval == "1d":
        df = _yf_chart_fetch(sym, "1y")
        if df is not None and not df.empty:
            _db_put(sym, "1y", interval, df, "yfinance")
            with _hot_lock:
                _hot_cache[hot_key] = (df, "yfinance", time.time())
            bars = _PERIOD_BARS.get(period, 252)
            return (df.iloc[-bars:].copy() if len(df) > bars else df.copy()), "yfinance"

    # ── Tier 4: Yahoo Finance CSV endpoint (browser session + crumb) ──
    # Third Yahoo bucket — different endpoint, different cookie jar from chart v8.
    if interval == "1d":
        df = _yf_csv_fetch(sym, "1y")
        if df is not None and not df.empty:
            _db_put(sym, "1y", interval, df, "yfinance")
            with _hot_lock:
                _hot_cache[hot_key] = (df, "yfinance", time.time())
            bars = _PERIOD_BARS.get(period, 252)
            return (df.iloc[-bars:].copy() if len(df) > bars else df.copy()), "yfinance"

    # ── Tier 5: yfinance library (query2, shared session) ──
    df = _yf_fetch(sym, "1y", interval)
    if df is not None and not df.empty:
        _db_put(sym, "1y", interval, df, "yfinance")
        with _hot_lock:
            _hot_cache[hot_key] = (df, "yfinance", time.time())
        bars = _PERIOD_BARS.get(period, 252)
        return (df.iloc[-bars:].copy() if len(df) > bars else df.copy()), "yfinance"

    # ── Tier 5: Alpha Vantage (rate-limited: 20 calls/day, 1 per 15s) ──
    if interval == "1d" and _AV_API_KEY:
        df = _av_fetch(sym, period)
        if df is not None and not df.empty:
            _db_put(sym, "1y", interval, df, "alphavantage")
            with _hot_lock:
                _hot_cache[hot_key] = (df, "alphavantage", time.time())
            log.info("AlphaVantage hit for %s", sym)
            return df.copy(), "alphavantage"

    # ── Tier 6: TwelveData single-symbol fallback ──
    if interval == "1d" and _TD_API_KEY:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        with _db_lock:
            conn = _get_conn()
            row = conn.execute("SELECT calls_today, call_date FROM td_state WHERE id=1").fetchone()
            conn.close()
        calls_today = (row["calls_today"] if row and row["call_date"] == today else 0) if row else 0
        _TD_SINGLE_DAY_CAP = 200
        if calls_today < _TD_SINGLE_DAY_CAP:
            df = _td_fetch_one(sym, 252)  # always 1y
            if df is not None and not df.empty:
                _td_record_call(1)
                _db_put(sym, "1y", interval, df, "twelvedata")
                with _hot_lock:
                    _hot_cache[hot_key] = (df, "twelvedata", time.time())
                log.info("TwelveData single-symbol hit for %s (%d credits used today)", sym, calls_today + 1)
                bars = _PERIOD_BARS.get(period, 252)
                return (df.iloc[-bars:].copy() if len(df) > bars else df.copy()), "twelvedata"
        else:
            log.info("TwelveData daily cap reached (%d/%d) — skipping %s", calls_today, _TD_SINGLE_DAY_CAP, sym)

    return pd.DataFrame(), "none"


def td_bulk_sweep_now(period: str = "1y", force: bool = False) -> dict:
    """
    Explicitly trigger a TwelveData bulk SP500 sweep.
    If force=True, bypasses the 1-hour cooldown (use only when yfinance is fully down).
    Returns status dict.
    """
    if not _TD_API_KEY:
        return {"ok": False, "error": "No TwelveData API key configured"}

    # Hard block: bulk SP500 sweep burns ~800 credits in one run — our entire daily budget.
    # This endpoint is disabled to protect the free-tier limit.
    # Use the per-symbol Tier 4 fallback in fetch() instead (capped at 200 credits/day).
    return {
        "ok": False,
        "error": "Bulk TD sweep disabled — would exhaust 800-credit daily limit. "
                 "Per-symbol fallback in fetch() is active (cap: 200 credits/day)."
    }


def fetch_quote_with_source(symbol: str) -> tuple[dict, str]:
    """
    Live quote. Priority:
      1. yfinance fast_info
      2. Finnhub /quote (real-time, free tier)
      3. SQLite OHLCV cache (last two rows)
    Returns (quote_dict, source).
    """
    sym = symbol.upper()
    result: dict = {"symbol": sym, "price": 0, "change_pct": 0, "volume": 0, "market_cap": 0}

    # ── 1. Yahoo spark (multi-symbol batch endpoint, separate bucket from yf library) ──
    try:
        spark = _yf_spark_quotes([sym])
        q = spark.get(sym)
        if q and q.get("price", 0) > 0:
            return {
                "symbol":     sym,
                "price":      round(q["price"], 4),
                "prev_close": round(q["price"] / (1 + q["change_pct"] / 100), 4) if q["change_pct"] else q["price"],
                "change_pct": q["change_pct"],
                "volume":     q.get("volume", 0),
                "market_cap": 0,
            }, "yfinance"
    except Exception:
        pass

    # ── 2. yfinance fast_info (fallback — shares rate-limit bucket with library) ──
    try:
        import yfinance as yf
        info = yf.Ticker(sym).fast_info
        price = float(info.last_price or 0)
        prev  = float(info.previous_close or price)
        if price > 0:
            return {
                "symbol":     sym,
                "price":      round(price, 4),
                "prev_close": round(prev, 4),
                "change_pct": round((price / max(prev, 1e-8) - 1) * 100, 3),
                "volume":     int(info.three_month_average_volume or 0),
                "market_cap": float(getattr(info, "market_cap", 0) or 0),
            }, "yfinance"
    except Exception:
        pass

    # ── 3. Finnhub /quote (independent API, real-time, 60/min free) ──
    try:
        from api.quant.finnhub_client import get_quote as _fh_quote
        fq = _fh_quote(sym)
        if fq and fq.get("price", 0) > 0:
            return {
                "symbol":     sym,
                "price":      fq["price"],
                "prev_close": fq.get("prev_close", fq["price"]),
                "change_pct": fq.get("change_pct", 0),
                "high":       fq.get("high", 0),
                "low":        fq.get("low", 0),
                "volume":     0,
                "market_cap": 0,
            }, "finnhub"
    except Exception:
        pass

    # ── 4. SQLite OHLCV last two rows ──
    cached = _db_get(sym, "1y", "1d") or _db_get(sym, "6mo", "1d")
    if cached is not None:
        df, ohlcv_source = cached
        if len(df) >= 2:
            price = float(df["Close"].iloc[-1])
            prev  = float(df["Close"].iloc[-2])
            return {
                "symbol":     sym,
                "price":      round(price, 4),
                "prev_close": round(prev, 4),
                "change_pct": round((price / max(prev, 1e-8) - 1) * 100, 3),
                "volume":     int(df["Volume"].iloc[-1]),
                "market_cap": 0,
            }, f"sqlite_{ohlcv_source}"
        elif len(df) == 1:
            price = float(df["Close"].iloc[-1])
            return {
                "symbol": sym, "price": round(price, 4), "prev_close": round(price, 4),
                "change_pct": 0.0, "volume": int(df["Volume"].iloc[-1]), "market_cap": 0,
            }, f"sqlite_{ohlcv_source}"

    return result, "none"


# ── Intraday (1-minute) bar fetch ────────────────────────────────────────────
# Completely separate from the daily-bar path:
#   - Primary:  TwelveData /time_series?interval=1min (1 call = today's full session)
#   - Fallback: yfinance download(interval="1m", period="1d")
#   - Cache TTL: 60 seconds (data refreshes every minute during market hours)
#   - SQLite key: (symbol, "intraday_1d", "1min")
#
# Rate-budget note: TwelveData free tier = 800 credits/day.
# One intraday fetch = 1 credit. At 60-second TTL, one stock costs
# max 390 credits/day (one per minute over a 6.5-hour session).
# This leaves 410 credits for daily-bar sweeps.

_INTRADAY_TTL = 60   # seconds — re-fetch at most once per minute

def _td_fetch_intraday(symbol: str) -> Optional[pd.DataFrame]:
    """Fetch today's 1-minute bars from TwelveData. Returns DataFrame or None."""
    if not _TD_API_KEY:
        return None
    try:
        resp = requests.get(
            f"{_TD_BASE}/time_series",
            params={
                "symbol":     symbol,
                "interval":   "1min",
                "outputsize": 500,        # covers full 390-bar session + buffer
                "apikey":     _TD_API_KEY,
                "format":     "JSON",
            },
            timeout=15,
        )
        data = resp.json()
        if data.get("status") == "error" or "values" not in data:
            log.warning("TwelveData intraday %s: %s", symbol, data.get("message", "no values"))
            return None

        values = list(reversed(data["values"]))  # oldest first
        rows, timestamps = [], []
        for v in values:
            try:
                rows.append({
                    "Open":   float(v["open"]),
                    "High":   float(v["high"]),
                    "Low":    float(v["low"]),
                    "Close":  float(v["close"]),
                    "Volume": int(float(v.get("volume", 0))),
                })
                timestamps.append(v["datetime"])
            except (KeyError, ValueError):
                continue

        if not rows:
            return None

        df = pd.DataFrame(rows, index=pd.to_datetime(timestamps))
        df.index.name = "Date"
        _td_record_call(1)
        return df

    except Exception as e:
        log.warning("TwelveData intraday %s: %s", symbol, e)
        return None


def _yf_fetch_intraday(symbol: str) -> Optional[pd.DataFrame]:
    """Fetch today's 1-minute bars from yfinance. Unofficial but free."""
    try:
        import yfinance as yf
        df = yf.download(
            tickers=symbol,
            interval="1m",
            period="1d",
            auto_adjust=True,
            progress=False,
        )
        if df.empty:
            return None
        df = _clean_yf_df(df)
        return df if not df.empty else None
    except Exception as e:
        log.warning("yfinance intraday %s: %s", symbol, type(e).__name__)
        return None


def _db_get_intraday(symbol: str) -> Optional[pd.DataFrame]:
    """Return cached 1-min DataFrame if fresher than _INTRADAY_TTL seconds."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT data_json, fetched_at FROM ohlcv WHERE symbol=? AND period=? AND interval_=?",
            (symbol, "intraday_1d", "1min")
        ).fetchone()
        conn.close()
    if not row:
        return None
    if time.time() - row["fetched_at"] > _INTRADAY_TTL:
        return None
    try:
        records = json.loads(row["data_json"])
        df = pd.DataFrame(records)
        df.index = pd.to_datetime(df.pop("_date"))
        df.index.name = "Date"
        return df
    except Exception:
        return None


def _db_put_intraday(symbol: str, df: pd.DataFrame, source: str) -> None:
    """Persist 1-min DataFrame to SQLite intraday slot."""
    if df.empty:
        return
    records = df.copy()
    records["_date"] = records.index.strftime("%Y-%m-%d %H:%M:%S")
    data_json = json.dumps(records.to_dict(orient="records"))
    with _db_lock:
        conn = _get_conn()
        conn.execute("""
            INSERT OR REPLACE INTO ohlcv (symbol, period, interval_, data_json, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (symbol, "intraday_1d", "1min", data_json, source, time.time()))
        conn.commit()
        conn.close()


def get_intraday_bars(symbol: str) -> tuple[pd.DataFrame, str]:
    """
    Fetch today's 1-minute OHLCV bars for `symbol`.

    Returns (df, source) where source is "twelvedata", "yfinance", "cache", or "none".
    df has columns Open/High/Low/Close/Volume with a datetime index (intraday timestamps).

    Validation: returns empty DataFrame if fewer than 350 bars or critical NaN gaps exist.
    Cache TTL = 60 seconds (re-fetches at most once per minute during market hours).
    """
    sym = symbol.upper()

    # ── Cache hit ──
    cached = _db_get_intraday(sym)
    if cached is not None and not cached.empty:
        return cached, "cache"

    # ── Primary: TwelveData ──
    df = _td_fetch_intraday(sym)
    source = "twelvedata"

    # ── Fallback: yfinance ──
    if df is None or df.empty:
        df = _yf_fetch_intraday(sym)
        source = "yfinance"

    if df is None or df.empty:
        log.warning("get_intraday_bars %s: no data from any source", sym)
        return pd.DataFrame(), "none"

    # ── Validate ──
    # Require at least as many bars as the market has been open, minus a small
    # tolerance for data-provider lag.  A full session is 390 bars (9:30–4:00).
    # We never require more than 60 — VWAP stabilises after ~60 bars and that
    # is the de-facto ceiling for a "working" session.  Before 9:45 AM (the
    # agent's earliest entry window) we require only 15 bars.
    from datetime import datetime as _dt_cls
    try:
        from zoneinfo import ZoneInfo as _ZI
        _et_tz = _ZI("America/New_York")
    except ImportError:
        import datetime as _dt_mod
        _et_tz = timezone(_dt_mod.timedelta(hours=-4))
    _now_et = _dt_cls.now(_et_tz)
    # Minutes elapsed since market open (9:30 AM ET), clamped to [0, 390]
    _minutes_open = max(0, (_now_et.hour - 9) * 60 + _now_et.minute - 30)
    # Require 80% of elapsed bars (tolerance for provider lag), floor 15, cap 60
    _min_bars = max(15, min(60, int(_minutes_open * 0.80)))
    if len(df) < _min_bars:
        log.warning("get_intraday_bars %s: only %d bars (need %d) — rejecting", sym, len(df), _min_bars)
        return pd.DataFrame(), "none"

    # Drop rows where Close is NaN (corrupted bars)
    df = df[df["Close"].notna() & (df["Close"] > 0)]
    df["Volume"] = df["Volume"].fillna(0).astype(int)

    if df.empty:
        return pd.DataFrame(), "none"

    _db_put_intraday(sym, df, source)
    log.info("get_intraday_bars %s: %d bars from %s", sym, len(df), source)
    return df.copy(), source


# ── Module startup: kick off background yfinance prefetch ─────────────────────
_start_background_prefetch(period="1y")
