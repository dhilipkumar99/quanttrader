"""
S&P 500 universe — full constituent list + fast batch quote streaming.
Uses yfinance batch download for minimal API calls.
"""
import os
import csv
import time
import threading
import yfinance as yf
import pandas as pd
from typing import Optional

def _load_sp500_symbols() -> list[str]:
    """Load S&P 500 symbols from snp_index.csv, normalising dot-notation to hyphen (BRK.B → BRK-B)."""
    csv_path = os.path.join(os.path.dirname(__file__), "snp_index.csv")
    symbols = []
    seen = set()
    try:
        with open(csv_path, newline="") as f:
            for row in csv.reader(f):
                if row and row[0].strip():
                    sym = row[0].strip().replace(".", "-")
                    if sym not in seen:
                        seen.add(sym)
                        symbols.append(sym)
    except FileNotFoundError:
        pass
    return symbols

SP500_SYMBOLS = _load_sp500_symbols()

# ── In-memory quote cache ──────────────────────────────────────────────────────
_quote_cache: dict[str, dict] = {}
_cache_lock  = threading.Lock()
_QUOTE_TTL   = 300  # 5 minutes — batch fetch takes 2+ min, must outlast the fetch
_refresh_running = False  # prevent concurrent refreshes


def _batch_fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """
    Multi-tier quote fetch: spark → yf.download → SQLite.
    Spark (query1.finance.yahoo.com/v7/finance/spark) is a separate rate-limit
    bucket from the yfinance library, so it doesn't collide with bg_refresh.
    """
    if not symbols:
        return {}

    out: dict[str, dict] = {}
    ts_now = time.time()

    # ── Tier 1: Yahoo spark endpoint (separate bucket, handles 100+ symbols in one call) ──
    try:
        from api.quant.ohlcv_store import _yf_spark_quotes
        spark = _yf_spark_quotes(symbols)
        for sym, q in spark.items():
            if q.get("price", 0) > 0:
                out[sym] = {
                    "symbol":     sym,
                    "price":      round(q["price"], 2),
                    "change_pct": q.get("change_pct", 0),
                    "volume":     q.get("volume", 0),
                    "market_cap": 0,
                    "ts":         ts_now,
                }
    except Exception:
        pass

    # ── Tier 2: yf.download() for any misses ──
    missed = [s for s in symbols if s not in out]
    if missed:
        try:
            raw = yf.download(
                tickers=missed,
                period="5d",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if not raw.empty:
                single = len(missed) == 1
                for sym in missed:
                    try:
                        if single:
                            df = raw.copy()
                            if isinstance(df.columns, pd.MultiIndex):
                                df.columns = df.columns.get_level_values(0)
                        else:
                            sym_u = sym.upper()
                            if sym_u not in raw.columns.get_level_values(0):
                                continue
                            df = raw[sym_u].dropna(how="all")
                        if df.empty:
                            continue
                        df = df.dropna(subset=["Close"])
                        if len(df) < 2:
                            continue
                        price = float(df["Close"].iloc[-1])
                        prev  = float(df["Close"].iloc[-2])
                        vol   = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
                        out[sym] = {
                            "symbol":     sym,
                            "price":      round(price, 2),
                            "change_pct": round(((price / prev) - 1) * 100, 3) if prev else 0.0,
                            "volume":     vol,
                            "market_cap": 0,
                            "ts":         ts_now,
                        }
                    except Exception:
                        continue
        except Exception:
            pass

    # ── Tier 3: SQLite OHLCV cache for remaining misses ──
    missed = [s for s in symbols if s not in out]
    if missed:
        try:
            from api.quant.ohlcv_store import _db_get
            for sym in missed:
                try:
                    cached = _db_get(sym, "6mo", "1d") or _db_get(sym, "1y", "1d")
                    if cached is None:
                        continue
                    df, _ = cached
                    df = df.dropna(subset=["Close"])
                    if len(df) < 2:
                        continue
                    price = float(df["Close"].iloc[-1])
                    prev  = float(df["Close"].iloc[-2])
                    vol   = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
                    out[sym] = {
                        "symbol":     sym,
                        "price":      round(price, 2),
                        "change_pct": round(((price / prev) - 1) * 100, 3) if prev else 0.0,
                        "volume":     vol,
                        "market_cap": 0,
                        "ts":         ts_now,
                    }
                except Exception:
                    continue
        except Exception:
            pass

    return out


def _do_refresh() -> None:
    """Blocking fetch of all symbols, updates cache. Call from background thread only."""
    global _refresh_running
    _refresh_running = True
    try:
        results: dict[str, dict] = {}
        chunk_size = 100
        for i in range(0, len(SP500_SYMBOLS), chunk_size):
            chunk = SP500_SYMBOLS[i : i + chunk_size]
            results.update(_batch_fetch_quotes(chunk))
        with _cache_lock:
            _quote_cache.update(results)
    except Exception:
        pass
    finally:
        _refresh_running = False


def get_sp500_quotes(force_refresh: bool = False) -> list[dict]:
    """
    Return quotes for all S&P 500 symbols.
    Serves from cache immediately if any data exists. Triggers a background refresh
    when cache is stale. TTL=300s so the cache outlasts the 2-min fetch time.
    """
    global _refresh_running
    now = time.time()
    with _cache_lock:
        fresh = [v for v in _quote_cache.values() if (now - v.get("ts", 0)) < _QUOTE_TTL]
        stale = [v for v in _quote_cache.values()]

    # If we have fresh data (>80% coverage), return immediately
    if not force_refresh and len(fresh) >= len(SP500_SYMBOLS) * 0.8:
        return sorted(fresh, key=lambda x: x.get("market_cap", 0), reverse=True)

    # Stale but not empty — serve stale data and refresh in background
    if stale and not _refresh_running:
        threading.Thread(target=_do_refresh, daemon=True).start()
        return sorted(stale, key=lambda x: x.get("market_cap", 0), reverse=True)

    # Cache is empty — must block (first cold start)
    if not _refresh_running:
        _do_refresh()
    with _cache_lock:
        all_data = list(_quote_cache.values())
    return sorted(all_data, key=lambda x: x.get("market_cap", 0), reverse=True)


def get_sp500_quote(symbol: str) -> Optional[dict]:
    """Get quote for a single S&P 500 symbol, using cache if fresh."""
    now = time.time()
    with _cache_lock:
        cached = _quote_cache.get(symbol)
        if cached and (now - cached.get("ts", 0)) < _QUOTE_TTL:
            return cached

    result = _batch_fetch_quotes([symbol])
    q = result.get(symbol)
    if q:
        with _cache_lock:
            _quote_cache[symbol] = q
    return q


def get_sp500_symbols() -> list[str]:
    return list(SP500_SYMBOLS)


# ── Background warm-up + periodic refresh ────────────────────────────────────
def _cache_refresh_loop():
    """Warm cache on startup, then refresh every 4 minutes so TTL (5min) never expires."""
    time.sleep(5)  # let server fully start
    while True:
        try:
            _do_refresh()
        except Exception:
            pass
        time.sleep(240)  # 4-minute interval

threading.Thread(target=_cache_refresh_loop, daemon=True).start()
