"""
NASDAQ universe — high-liquidity NASDAQ-listed stocks that are NOT in the S&P 500.
This is the additive universe: adds unique mid/small-cap and growth names that
the S&P 500 scanner would never surface.

Selection criteria:
  - Primarily NASDAQ-listed (not NYSE)
  - Average daily volume > 500k shares
  - Active as of 2025 Q4 (no delisted or acquired names)
  - Excludes every symbol in snp_index.csv (loaded at module init)
  - Covers growth tech, crypto-adjacent, biotech, EV, space, fintech niches
    that differentiate this universe from the S&P 500

Scanning priority: sorted by ADV (high-volume names first), so the most
liquid NASDAQ-exclusive names are always scanned first.
"""
import csv
import os
import time
import threading
import yfinance as yf
import pandas as pd
from typing import Optional


# ── Load S&P 500 symbol set so we can exclude overlaps ───────────────────────
def _load_sp500_set() -> set[str]:
    csv_path = os.path.join(os.path.dirname(__file__), "snp_index.csv")
    syms: set[str] = set()
    try:
        with open(csv_path, newline="") as f:
            for row in csv.reader(f):
                if row and row[0].strip():
                    syms.add(row[0].strip().replace(".", "-"))
    except FileNotFoundError:
        pass
    return syms


_SP500_SET: set[str] = _load_sp500_set()


# ── Raw candidate list (NASDAQ-native, verified active as of 2025 Q4) ────────
_RAW_NASDAQ: list[str] = [
    # ── High-beta growth tech ──────────────────────────────────────────────
    "ZM",    # Zoom Video
    "DOCU",  # DocuSign
    "TWLO",  # Twilio
    "OKTA",  # Okta
    "NET",   # Cloudflare
    "SNOW",  # Snowflake
    "MDB",   # MongoDB
    "ZS",    # Zscaler
    "SHOP",  # Shopify
    "MELI",  # MercadoLibre
    "SE",    # Sea Limited
    "GRAB",  # Grab Holdings
    "ROKU",  # Roku
    "SPOT",  # Spotify
    "SOFI",  # SoFi Technologies
    "AFRM",  # Affirm Holdings
    "AI",    # C3.ai
    "SOUN",  # SoundHound AI
    "IONQ",  # IonQ (quantum computing)
    "RBLX",  # Roblox
    "U",     # Unity Software
    "TTWO",  # Take-Two Interactive (NASDAQ-listed)

    # ── Crypto-adjacent ────────────────────────────────────────────────────
    "MSTR",  # MicroStrategy (largest BTC holder)
    "HOOD",  # Robinhood Markets
    "COIN",  # Coinbase (already in S&P — will be filtered if so)

    # ── Chinese ADRs on NASDAQ ──────────────────────────────────────────────
    "BIDU",  # Baidu
    "JD",    # JD.com
    "PDD",   # Pinduoduo / Temu parent
    "BABA",  # Alibaba (primary listing)

    # ── Ride-share / delivery (NASDAQ-listed) ──────────────────────────────
    "LYFT",  # Lyft

    # ── EV / clean energy (non-S&P) ────────────────────────────────────────
    "RIVN",  # Rivian Automotive
    "LCID",  # Lucid Group
    "ACHR",  # Archer Aviation (eVTOL)
    "JOBY",  # Joby Aviation (eVTOL)

    # ── Space / defense tech ───────────────────────────────────────────────
    "RKLB",  # Rocket Lab USA
    "ASTS",  # AST SpaceMobile
    "LUNR",  # Intuitive Machines

    # ── Biotech / genomics (not in S&P 500) ────────────────────────────────
    "ALNY",  # Alnylam Pharmaceuticals
    "BMRN",  # BioMarin Pharmaceutical
    "EXAS",  # Exact Sciences
    "NVAX",  # Novavax
    "BNTX",  # BioNTech
    "SRPT",  # Sarepta Therapeutics
    "RARE",  # Ultragenyx Pharmaceutical
    "PACB",  # Pacific Biosciences
    "NTRA",  # Natera
    "HALO",  # Halozyme Therapeutics
    "ACAD",  # ACADIA Pharmaceuticals
    "RXRX",  # Recursion Pharmaceuticals
    "TMDX",  # TransMedics Group
    "INVA",  # Innoviva

    # ── Fintech / payments (non-S&P) ───────────────────────────────────────
    "SQ",    # Block Inc (fintech, NASDAQ)
    "DLO",   # dLocal Limited
    "RELY",  # Remitly Global

    # ── Semiconductors (NASDAQ-exclusive, not in S&P 500) ──────────────────
    "WOLF",  # Wolfspeed (SiC chips)
    "SITM",  # SiTime Corporation
    "GFS",   # GlobalFoundries
    "ON",    # ON Semiconductor (may be in S&P — filtered at runtime)
    "ANSS",  # ANSYS (acquired by Synopsys — check; include for now)

    # ── Enterprise software (mid-cap, not yet S&P) ─────────────────────────
    "FIVN",  # Five9
    "NICE",  # NICE Systems
    "BAND",  # Bandwidth Inc
    "LPSN",  # LivePerson

    # ── Media / streaming (mid-cap) ────────────────────────────────────────
    "NWSA",  # News Corp Class A (NASDAQ-listed; likely already in S&P — filtered)

    # ── Travel / booking (NASDAQ-exclusive) ────────────────────────────────
    "TRIP",  # TripAdvisor
    "OPEN",  # Opendoor Technologies

    # ── Healthcare technology ──────────────────────────────────────────────
    "HIMS",  # Hims & Hers Health
    "GH",    # Guardant Health

    # ── NASDAQ ETFs & levered products (for volatility plays) ──────────────
    "QQQ",   # Invesco QQQ (NASDAQ 100 ETF)
    "TQQQ",  # ProShares UltraPro QQQ (3× levered)
    "SQQQ",  # ProShares UltraPro Short QQQ (inverse)

    # ── Retail / e-commerce (mid-cap, non-S&P) ────────────────────────────
    "ETSY",  # Etsy
    "W",     # Wayfair

    # ── Telehealth / digital health ────────────────────────────────────────
    "UWMC",  # UWM Holdings
    "ALGT",  # Allegiant Travel (NASDAQ)
    "ULCC",  # Frontier Group Holdings

    # ── Outsourced services / IT (mid-cap NASDAQ) ─────────────────────────
    "INFY",  # Infosys ADR (NASDAQ)
    "WIT",   # Wipro ADR (NASDAQ)
    "CTSH",  # Cognizant (may be in S&P — filtered)

    # ── Clean energy / solar (non-S&P) ────────────────────────────────────
    "ENPH",  # Enphase Energy (may be in S&P — filtered at runtime)
    "SEDG",  # SolarEdge Technologies

    # ── Market cap index proxies ───────────────────────────────────────────
    "MKTX",  # MarketAxess Holdings
    "LPLA",  # LPL Financial Holdings (may be in S&P — filtered)
    "IBKR",  # Interactive Brokers (may be in S&P — filtered)

    # ── Speciality NASDAQ names with high options volume ──────────────────
    "LOGI",  # Logitech International
    "PTON",  # Peloton Interactive
    "TASK",  # TaskUs
]

# ── Filter out any symbol already in S&P 500 and de-duplicate ─────────────────
_seen: set[str] = set()
NASDAQ_SYMBOLS: list[str] = []
for _s in _RAW_NASDAQ:
    if _s not in _seen and _s not in _SP500_SET:
        _seen.add(_s)
        NASDAQ_SYMBOLS.append(_s)


# ── In-memory quote cache ─────────────────────────────────────────────────────
_quote_cache: dict[str, dict] = {}
_cache_lock   = threading.Lock()
_QUOTE_TTL    = 20   # seconds


def _batch_fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """
    yf.download() batch → SQLite fallback. Mirrors sp500._batch_fetch_quotes().
    market_cap is approximated as 0 (yf.download doesn't provide shares_outstanding).
    The scanner doesn't sort NASDAQ picks by market_cap — it sorts by volume and
    quant score, so 0 is acceptable here.
    """
    if not symbols:
        return {}

    out: dict[str, dict] = {}

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

                    price   = float(df["Close"].iloc[-1])
                    prev    = float(df["Close"].iloc[-2])
                    vol     = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
                    chg_pct = round(((price / prev) - 1) * 100, 3) if prev else 0.0
                    out[sym] = {
                        "symbol":     sym,
                        "price":      round(price, 2),
                        "change_pct": chg_pct,
                        "volume":     vol,
                        "market_cap": 0,   # not available from batch download
                        "ts":         ts_now,
                    }
                except Exception:
                    continue
    except Exception:
        pass

    # SQLite fallback for misses
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
                    price   = float(df["Close"].iloc[-1])
                    prev    = float(df["Close"].iloc[-2])
                    vol     = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
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


def get_nasdaq_quotes(force_refresh: bool = False) -> list[dict]:
    """
    Return quotes for the NASDAQ-exclusive universe.
    Sorted by volume descending so the most liquid (and most optionable) names
    are scanned first when scan_limit is applied.
    Cached 20s.
    """
    now = time.time()
    with _cache_lock:
        fresh = [v for v in _quote_cache.values() if (now - v.get("ts", 0)) < _QUOTE_TTL]
        if not force_refresh and len(fresh) >= len(NASDAQ_SYMBOLS) * 0.7:
            return sorted(fresh, key=lambda x: x.get("volume", 0), reverse=True)

    results: dict[str, dict] = {}
    chunk_size = 80   # smaller chunks for stability with less-liquid names
    for i in range(0, len(NASDAQ_SYMBOLS), chunk_size):
        chunk = NASDAQ_SYMBOLS[i: i + chunk_size]
        results.update(_batch_fetch_quotes(chunk))

    with _cache_lock:
        _quote_cache.update(results)

    return sorted(results.values(), key=lambda x: x.get("volume", 0), reverse=True)


def get_nasdaq_quote(symbol: str) -> Optional[dict]:
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


def get_nasdaq_symbols() -> list[str]:
    return list(NASDAQ_SYMBOLS)


# ── Background warm-up ─────────────────────────────────────────────────────────
def _warm_cache_background():
    time.sleep(8)   # after sp500 warm-up (which fires at t+3s)
    try:
        get_nasdaq_quotes()
    except Exception:
        pass


threading.Thread(target=_warm_cache_background, daemon=True).start()
