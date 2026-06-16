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
_QUOTE_TTL   = 20  # seconds


def _batch_fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """
    Download quotes for up to 500 symbols via yf.download() (single HTTP call),
    falling back to the OHLCV SQLite cache for symbols that fail.
    Avoids fast_info / per-ticker calls that trip Yahoo's rate limiter.
    """
    if not symbols:
        return {}

    out: dict[str, dict] = {}

    # ── Primary: yf.download() — one HTTP call, 2-day window for price + volume ──
    try:
        raw = yf.download(
            tickers=symbols,
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        ts_now = time.time()
        if not raw.empty:
            single = len(symbols) == 1
            for sym in symbols:
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
                    chg_pct = round(((price / prev) - 1) * 100, 3) if prev else 0.0
                    # Approximate market cap: not available from download; omit (0)
                    out[sym] = {
                        "symbol":     sym,
                        "price":      round(price, 2),
                        "change_pct": chg_pct,
                        "volume":     vol,
                        "market_cap": 0,
                        "ts":         ts_now,
                    }
                except Exception:
                    continue
    except Exception:
        pass  # fall through to SQLite cache

    # ── Fallback: pull last bar from OHLCV SQLite cache for any misses ──
    missed = [s for s in symbols if s not in out]
    if missed:
        try:
            from api.quant.ohlcv_store import _db_get
            ts_now = time.time()
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
                    chg_pct = round(((price / prev) - 1) * 100, 3) if prev else 0.0
                    out[sym] = {
                        "symbol":     sym,
                        "price":      round(price, 2),
                        "change_pct": chg_pct,
                        "volume":     vol,
                        "market_cap": 0,
                        "ts":         ts_now,
                    }
                except Exception:
                    continue
        except Exception:
            pass

    return out


def get_sp500_quotes(force_refresh: bool = False) -> list[dict]:
    """
    Return quotes for all S&P 500 symbols.
    Cached for 20 seconds. On first call, fetches in chunks of 100.
    """
    now = time.time()
    with _cache_lock:
        # Check if we have a recent full snapshot
        fresh = [v for v in _quote_cache.values() if (now - v.get("ts", 0)) < _QUOTE_TTL]
        if not force_refresh and len(fresh) >= len(SP500_SYMBOLS) * 0.8:
            return sorted(fresh, key=lambda x: x.get("market_cap", 0), reverse=True)

    # Fetch in chunks of 100 to avoid yfinance request limits
    results = {}
    chunk_size = 100
    for i in range(0, len(SP500_SYMBOLS), chunk_size):
        chunk = SP500_SYMBOLS[i : i + chunk_size]
        results.update(_batch_fetch_quotes(chunk))

    with _cache_lock:
        _quote_cache.update(results)

    return sorted(results.values(), key=lambda x: x.get("market_cap", 0), reverse=True)


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


# ── Background warm-up thread ─────────────────────────────────────────────────
def _warm_cache_background():
    """Pre-warm the quote cache on server startup (non-blocking)."""
    time.sleep(3)  # let server start first
    try:
        get_sp500_quotes()
    except Exception:
        pass

threading.Thread(target=_warm_cache_background, daemon=True).start()
