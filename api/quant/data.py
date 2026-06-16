"""
Data fetching layer — thin shim over ohlcv_store.
Keeps the original fetch() / fetch_quote() signatures for backward compatibility.
"""

import pandas as pd
from api.quant.ohlcv_store import (
    fetch as _fetch_with_source,
    fetch_quote_with_source as _fetch_quote_with_source,
    get_td_state,
)


def fetch(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """Legacy interface — returns DataFrame only (source discarded)."""
    df, _ = _fetch_with_source(symbol, period, interval)
    return df


def fetch_with_source(symbol: str, period: str = "1y", interval: str = "1d") -> tuple[pd.DataFrame, str]:
    """Extended interface — returns (DataFrame, source_string)."""
    return _fetch_with_source(symbol, period, interval)


def fetch_quote(symbol: str) -> dict:
    """Legacy interface — returns quote dict only."""
    result, _ = _fetch_quote_with_source(symbol)
    return result


def fetch_quote_with_source(symbol: str) -> tuple[dict, str]:
    """Extended interface — returns (quote_dict, source_string)."""
    return _fetch_quote_with_source(symbol)


def fetch_multi(symbols: list[str], period: str = "6mo", interval: str = "1d") -> dict[str, pd.DataFrame]:
    """Batch fetch for watchlist ranking — returns dict of DataFrames."""
    return {sym: fetch(sym, period, interval) for sym in symbols}


def adv_normalise(df: pd.DataFrame, window: int = 20):
    """ADV-normalised daily volume (QuantBasics §5.1)."""
    adv = df["Volume"].rolling(window).mean()
    return df["Volume"] / (adv + 1)
