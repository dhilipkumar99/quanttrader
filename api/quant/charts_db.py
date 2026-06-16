"""
Chart cache — SQLite-backed, yfinance-first, zero TwelveData spend.

Design:
  - Chart data is built from yfinance yf.download() batch (all symbols in one HTTP call)
  - TwelveData is NEVER called here — it is reserved exclusively for ohlcv_store.py
    OHLCV analysis fallback, gated by its own 1-hour cooldown
  - Sweep runs at most once per hour (SWEEP_TTL); subsequent requests are SQLite hits
  - Source of truth is the OHLCV SQLite in ohlcv_store — we reuse that data for charts
    so there is zero duplication of API spend
  - Falls back to per-symbol yf.Ticker() if batch fails for a symbol

Database: charts_cache.db (separate from ohlcv_cache.db for clean separation)
  charts(symbol TEXT PK, candles_6mo TEXT, candles_3mo TEXT, candles_1w TEXT, fetched_at REAL)
  sweep_meta(id INTEGER PK CHECK(id=1), started_at REAL, finished_at REAL, symbols_count INT, source TEXT)
"""

import json
import logging
import os
import threading
import time
import sqlite3
from typing import Optional

log = logging.getLogger("charts_db")

_DB_PATH    = os.path.join(os.path.dirname(__file__), "charts_cache.db")
_SWEEP_TTL  = 3600   # 1 hour — never re-sweep within this window
_THIN: dict[str, int] = {"6mo": 130, "3mo": 65, "1w": 7}

_db_lock       = threading.Lock()
_sweep_lock    = threading.Lock()
_sweep_running = False


# ── DB init ───────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db_lock:
        conn = _get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS charts (
                symbol      TEXT PRIMARY KEY,
                candles_6mo TEXT NOT NULL,
                candles_3mo TEXT NOT NULL,
                candles_1w  TEXT NOT NULL,
                fetched_at  REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sweep_meta (
                id            INTEGER PRIMARY KEY CHECK (id = 1),
                started_at    REAL,
                finished_at   REAL,
                symbols_count INTEGER,
                source        TEXT
            );
        """)
        conn.commit()
        conn.close()


_init_db()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _thin(candles: list[dict], target: int) -> list[dict]:
    if len(candles) <= target:
        return candles
    step = len(candles) / target
    return [candles[int(i * step)] for i in range(target)]


def _df_to_candles(df) -> list[dict]:
    """Convert a yfinance DataFrame to our candle list format. Drops NaN rows."""
    import math
    candles = []
    for dt, row in df.iterrows():
        try:
            o = float(row["Open"])
            h = float(row["High"])
            l = float(row["Low"])
            c = float(row["Close"])
            v = float(row.get("Volume", 0))
            # Skip rows with any NaN / inf
            if any(math.isnan(x) or math.isinf(x) for x in [o, h, l, c]):
                continue
            if c <= 0:
                continue
            candles.append({
                "date":   str(dt)[:10],
                "open":   round(o, 4),
                "high":   round(h, 4),
                "low":    round(l, 4),
                "close":  round(c, 4),
                "volume": int(v) if not (math.isnan(v) or math.isinf(v)) else 0,
            })
        except (KeyError, ValueError, TypeError):
            continue
    return candles


def _candles_to_periods(candles: list[dict]) -> dict[str, list[dict]]:
    clean = _sanitize_candles(candles)
    return {
        "6mo": _thin(clean, _THIN["6mo"]),
        "3mo": _thin(clean[-65:] if len(clean) >= 65 else clean, _THIN["3mo"]),
        "1w":  _thin(clean[-7:]  if len(clean) >= 7  else clean,  _THIN["1w"]),
    }


# ── yfinance batch fetch (zero TwelveData spend) ─────────────────────────────

def _yf_batch_fetch(symbols: list[str]) -> dict[str, list[dict]]:
    """
    Download 6-month daily bars for all symbols in one yf.download() call.
    This is a single HTTP request — no per-ticker throttling.
    Returns {symbol: candle_list}.
    """
    try:
        import yfinance as yf
        import pandas as pd

        raw = yf.download(
            tickers=symbols,
            period="6mo",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        if raw.empty:
            return {}

        result: dict[str, list[dict]] = {}

        if len(symbols) == 1:
            sym = symbols[0].upper()
            # Flat columns for single-ticker download
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.get_level_values(0)
            candles = _df_to_candles(raw)
            if candles:
                result[sym] = candles
        else:
            for sym in symbols:
                sym_u = sym.upper()
                try:
                    if sym_u not in raw.columns.get_level_values(0):
                        continue
                    df = raw[sym_u].dropna(how="all")
                    candles = _df_to_candles(df)
                    if candles:
                        result[sym_u] = candles
                except Exception as e:
                    log.debug("batch parse %s: %s", sym, e)

        return result

    except Exception as e:
        log.warning("yf batch download error (%d syms): %s", len(symbols), type(e).__name__)
        return {}


def _yf_single_fetch(symbol: str) -> Optional[list[dict]]:
    """Per-symbol fallback when batch misses a symbol."""
    # First try: pull from the OHLCV SQLite store (already populated by ohlcv_store prefetch)
    try:
        from api.quant.ohlcv_store import _db_get as _ohlcv_get
        cached = _ohlcv_get(symbol, "1y", "1d") or _ohlcv_get(symbol, "6mo", "1d")
        if cached is not None:
            df, _ = cached
            # Filter to last 6 months
            import pandas as pd
            cutoff = pd.Timestamp.now(tz="UTC") - pd.DateOffset(months=6)
            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            df = df[df.index >= cutoff]
            candles = _df_to_candles(df)
            if candles:
                return candles
    except Exception as e:
        log.debug("ohlcv_store fallback %s: %s", symbol, e)

    # Second try: direct yfinance Ticker
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="6mo", interval="1d")
        if not df.empty:
            candles = _df_to_candles(df)
            if candles:
                return candles
    except Exception as e:
        log.warning("yf single fetch %s: %s", symbol, type(e).__name__)

    # Third try: Alpha Vantage (rate-limited fallback — only when both yfinance paths fail)
    try:
        from api.quant.ohlcv_store import _av_fetch
        df = _av_fetch(symbol, "6mo")
        if df is not None and not df.empty:
            candles = _df_to_candles(df)
            if candles:
                log.info("AlphaVantage chart hit for %s", symbol)
                return candles
    except Exception as e:
        log.debug("AV chart %s: %s", symbol, type(e).__name__)

    return None


# ── DB read/write ─────────────────────────────────────────────────────────────

def _save_symbol(conn: sqlite3.Connection, symbol: str, periods: dict) -> None:
    conn.execute("""
        INSERT OR REPLACE INTO charts (symbol, candles_6mo, candles_3mo, candles_1w, fetched_at)
        VALUES (?, ?, ?, ?, ?)
    """, (symbol, json.dumps(periods["6mo"]), json.dumps(periods["3mo"]),
          json.dumps(periods["1w"]), time.time()))


def _sanitize_candles(candles: list[dict]) -> list[dict]:
    """Remove any candle rows that contain NaN/None values (today's incomplete bar)."""
    import math
    clean = []
    for c in candles:
        try:
            if any(
                c.get(k) is None or (isinstance(c.get(k), float) and math.isnan(c[k]))
                for k in ("open", "high", "low", "close")
            ):
                continue
            if (c.get("close") or 0) <= 0:
                continue
            clean.append(c)
        except Exception:
            continue
    return clean


def get_chart(symbol: str, period: str = "6mo") -> Optional[list[dict]]:
    col = {"6mo": "candles_6mo", "3mo": "candles_3mo", "1w": "candles_1w"}.get(period)
    if not col:
        return None
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(f"SELECT {col} FROM charts WHERE symbol = ?", (symbol,)).fetchone()
        conn.close()
    if not row:
        return None
    return _sanitize_candles(json.loads(row[0]))


def get_charts_batch(symbols: list[str], period: str = "6mo") -> dict[str, list[dict]]:
    col = {"6mo": "candles_6mo", "3mo": "candles_3mo", "1w": "candles_1w"}.get(period, "candles_6mo")
    placeholders = ",".join("?" * len(symbols))
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            f"SELECT symbol, {col} FROM charts WHERE symbol IN ({placeholders})", symbols
        ).fetchall()
        conn.close()
    return {row["symbol"]: _sanitize_candles(json.loads(row[col])) for row in rows}


def get_sweep_status() -> dict:
    with _db_lock:
        conn = _get_conn()
        meta = conn.execute("SELECT * FROM sweep_meta WHERE id = 1").fetchone()
        count = conn.execute("SELECT COUNT(*) FROM charts").fetchone()[0]
        conn.close()
    if not meta:
        return {"swept": False, "symbols_cached": count, "started_at": None,
                "finished_at": None, "age_seconds": None, "stale": True, "source": None}
    age = time.time() - (meta["finished_at"] or 0)
    return {
        "swept":          meta["finished_at"] is not None,
        "symbols_cached": count,
        "started_at":     meta["started_at"],
        "finished_at":    meta["finished_at"],
        "age_seconds":    round(age),
        "stale":          age > _SWEEP_TTL,
        "source":         meta["source"],
    }


def sweep_is_stale() -> bool:
    return get_sweep_status()["stale"]


# ── Sweep orchestration ───────────────────────────────────────────────────────

def run_sweep(symbols: list[str], force: bool = False) -> dict:
    """
    Batch-download 6mo chart data for all symbols via yfinance (zero TwelveData spend).
    Runs in a background thread; returns immediately.
    Skips if a fresh sweep was completed within the last hour (unless force=True).
    """
    global _sweep_running

    if not force and not sweep_is_stale():
        return {"status": "skipped", "reason": "cache is fresh", **get_sweep_status()}

    with _sweep_lock:
        if _sweep_running:
            return {"status": "already_running"}
        _sweep_running = True

    def _do_sweep():
        global _sweep_running
        started = time.time()
        source = "yfinance"
        log.info("Chart sweep starting: %d symbols via %s", len(symbols), source)

        with _db_lock:
            conn = _get_conn()
            conn.execute("""
                INSERT OR REPLACE INTO sweep_meta (id, started_at, finished_at, symbols_count, source)
                VALUES (1, ?, NULL, ?, ?)
            """, (started, len(symbols), source))
            conn.commit()
            conn.close()

        ok = 0
        fail = 0
        batch_size = 100  # yf.download handles ~100+ symbols fine in one call

        for batch_start in range(0, len(symbols), batch_size):
            batch = symbols[batch_start: batch_start + batch_size]
            log.info("Chart sweep batch %d-%d / %d", batch_start, batch_start + len(batch), len(symbols))

            fetched = _yf_batch_fetch(batch)

            # For any symbols the batch missed, try single-symbol fallbacks
            missed = [s for s in batch if s.upper() not in fetched]
            for sym in missed:
                candles = _yf_single_fetch(sym)
                if candles:
                    fetched[sym.upper()] = candles

            with _db_lock:
                conn = _get_conn()
                for sym_u, candles in fetched.items():
                    periods = _candles_to_periods(candles)
                    _save_symbol(conn, sym_u, periods)
                    ok += 1
                conn.commit()
                conn.close()

            fail += len(batch) - len(fetched)
            log.info("Chart sweep batch done: %d ok, %d fail", ok, fail)

            # Brief pause between large batches — yfinance is polite about this
            if batch_start + batch_size < len(symbols):
                time.sleep(2)

        finished = time.time()
        with _db_lock:
            conn = _get_conn()
            conn.execute("UPDATE sweep_meta SET finished_at=?, symbols_count=? WHERE id=1",
                         (finished, ok))
            conn.commit()
            conn.close()

        log.info("Chart sweep complete: %d ok, %d fail, %.0fs", ok, fail, finished - started)
        _sweep_running = False

    t = threading.Thread(target=_do_sweep, daemon=True, name="chart-sweep")
    t.start()
    return {"status": "started", "symbols": len(symbols), "source": "yfinance"}


# ── On-demand single-symbol fetch (used by /api/chart-data/<symbol>) ──────────

def ensure_chart(symbol: str) -> Optional[dict[str, list[dict]]]:
    """
    Return chart data for a single symbol, fetching if not cached.
    Used when a user searches a symbol not yet in the chart sweep.
    Does NOT call TwelveData.
    """
    sym = symbol.upper()

    # Check SQLite first
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT candles_6mo, candles_3mo, candles_1w, fetched_at FROM charts WHERE symbol=?",
            (sym,)
        ).fetchone()
        conn.close()

    if row:
        age = time.time() - row["fetched_at"]
        if age < _SWEEP_TTL:
            return {
                "6mo": _sanitize_candles(json.loads(row["candles_6mo"])),
                "3mo": _sanitize_candles(json.loads(row["candles_3mo"])),
                "1w":  _sanitize_candles(json.loads(row["candles_1w"])),
            }

    # Not cached or stale — fetch on-demand (no TwelveData)
    candles = _yf_single_fetch(sym)
    if not candles:
        return None

    periods = _candles_to_periods(candles)
    with _db_lock:
        conn = _get_conn()
        _save_symbol(conn, sym, periods)
        conn.commit()
        conn.close()

    return periods
