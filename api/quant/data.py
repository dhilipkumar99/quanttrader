"""
Data fetching layer — wraps yfinance with caching and validation.
Implements the data quality checks from QuantBasics §2.4.
"""

import yfinance as yf
import pandas as pd
import numpy as np
import time
import threading
from functools import lru_cache
from typing import Optional


_cache: dict = {}
_cache_lock = threading.Lock()
_CACHE_TTL  = 60  # seconds for intraday; longer for daily


def fetch(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """
    Fetch OHLCV data with caching and basic sanity checks (QuantBasics §2.4).
    Returns empty DataFrame on failure rather than raising.
    """
    key = f"{symbol}|{period}|{interval}"
    ttl = 30 if interval in ("1m", "5m", "15m") else _CACHE_TTL

    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["ts"]) < ttl:
            return entry["df"].copy()

    try:
        ticker = yf.Ticker(symbol)
        df     = ticker.history(period=period, interval=interval)

        if df.empty:
            return pd.DataFrame()

        # ── Sanity checks (§2.4) ──
        # Prices must be positive
        df = df[df["Close"] > 0]
        # Volumes must be non-negative
        df = df[df["Volume"] >= 0]
        # Forward-fill at most 3 consecutive NaNs (split/halt artifacts)
        df = df.ffill(limit=3)
        # Drop any remaining NaNs
        df = df.dropna(subset=["Close", "Volume"])

        # Normalise column names
        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()

        with _cache_lock:
            _cache[key] = {"df": df, "ts": time.time()}

        return df.copy()

    except Exception:
        return pd.DataFrame()


def fetch_quote(symbol: str) -> dict:
    """Live quote: last price, change, volume."""
    try:
        t = yf.Ticker(symbol)
        info = t.fast_info
        return {
            "symbol":   symbol,
            "price":    round(float(info.last_price or 0), 4),
            "prev_close": round(float(info.previous_close or 0), 4),
            "change_pct": round(
                (float(info.last_price or 0) /
                 max(float(info.previous_close or 1), 1e-8) - 1) * 100, 3
            ),
            "volume":  int(info.three_month_average_volume or 0),
            "market_cap": float(getattr(info, "market_cap", 0) or 0),
        }
    except Exception:
        return {"symbol": symbol, "price": 0, "change_pct": 0, "volume": 0}


def fetch_multi(symbols: list[str], period: str = "6mo", interval: str = "1d") -> dict[str, pd.DataFrame]:
    """Batch fetch for watchlist ranking."""
    return {sym: fetch(sym, period, interval) for sym in symbols}


def adv_normalise(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """
    Compute ADV-normalised daily volume (QuantBasics §5.1).
    Returns series: today_volume / rolling_adv.
    """
    adv = df["Volume"].rolling(window).mean()
    return df["Volume"] / (adv + 1)
