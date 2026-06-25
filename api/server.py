"""
Local development FastAPI server.
Loads the quant engine ONCE at startup — all subsequent requests reuse the warm model.
In production, Vercel runs api/*.py as serverless functions directly (no this file needed).

Usage: python api/server.py   (starts on port 8787)
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Load .env.local into os.environ before any modules read API keys
_env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env.local")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import uvicorn
import time as _time
import threading as _threading

import numpy as np
from api.quant.engine import QuantEngine, PerformanceMetrics, HORIZONS, DEFAULT_HORIZON
from api.quant.simulator import PaperTrader
from api.quant.data import fetch, fetch_quote, fetch_with_source, fetch_quote_with_source
from api.quant.ohlcv_store import get_td_state, td_bulk_sweep_now
from api.quant.broker import (
    get_account, get_positions, get_orders,
    submit_order, cancel_order, get_order_book,
    get_bars, get_market_movers
)
from api.quant.sp500 import get_sp500_quotes, get_sp500_quote, get_sp500_symbols, SP500_SYMBOLS
from api.quant.nasdaq import get_nasdaq_quotes, get_nasdaq_quote, get_nasdaq_symbols, NASDAQ_SYMBOLS
from api.quant.agent import AgentLoop
from api.quant.charts_db import (
    get_chart, get_charts_batch, get_sweep_status, run_sweep, sweep_is_stale, ensure_chart
)
from api.quant.ohlcv_store import _clean_yf_df, _db_put_many

app = FastAPI(title="QuantTrader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH"],
    allow_headers=["*"],
)

# ── Warm singleton — loaded once, reused across all requests ──
_engine = QuantEngine()
print("✓ QuantEngine ready", flush=True)

# ── Agent loop — starts in background daemon thread ──
_agent = AgentLoop.instance()
print("✓ AgentLoop ready", flush=True)

# ── Stale-while-revalidate cache — declared here so prewarm thread can write to it ──
_server_cache: dict = {}
_server_cache_lock = _threading.Lock()
_recomputing: set[str] = set()
_compute_events: dict[str, "_threading.Event"] = {}  # shared events for concurrent cache-miss waiters

# Sentinel stored in _server_cache when a symbol genuinely has no data
# (invalid ticker, delisted, etc.) so we return 404 instead of 503 "computing".
_NO_DATA = object()

# ── Pre-warm OHLCV cache for the most-requested symbols so the first
#    /api/analyze call hits SQLite, not a live yfinance download ──────────────
_prewarm_done = False
# Set True after _bg_refresh stores the full universe in SQLite.
# daytrade-picks returns 503 until this is True so it never fires
# 80 single-symbol yfinance downloads on an empty SQLite.
_bg_refresh_done = False

def _build_analyze_val(result, quote, quote_source, data_source):
    source_label = _build_source_label(data_source, quote_source)
    return {
        "symbol":               result.symbol,
        "price":                quote.get("price", 0),
        "change_pct":           quote.get("change_pct", 0),
        "composite_signal":     result.composite_signal,
        "composite_confidence": result.composite_confidence,
        "regime":               result.regime,
        "position_size_pct":    result.position_size_pct,
        "expected_return":      result.expected_return,
        "risk_metrics":         result.risk_metrics,
        "indicators":           result.indicators,
        "monte_carlo":          result.monte_carlo,
        "data_source":          source_label,
        "beginner_summary":     getattr(result, "beginner_summary", ""),
        "oos_sharpe":           getattr(result, "oos_sharpe", 0.0),
        "feature_importance":   getattr(result, "feature_importance", []),
        "signals": [
            {
                "source":      s.source,
                "direction":   s.direction,
                "confidence":  round(s.confidence, 4),
                "stop_loss":   round(s.stop_loss, 4),
                "take_profit": round(s.take_profit, 4),
            }
            for s in result.signals
        ],
    }

def _cache_symbol(sym: str, period: str, df, data_source: str):
    """Build and store analyze + candles results for one symbol."""
    result = _engine.analyze(df, sym)
    quote, quote_source = fetch_quote_with_source(sym)
    analyze_val = _build_analyze_val(result, quote, quote_source, data_source)
    rows = [
        {
            "date":   str(date)[:10],
            "price":  round(float(row["Close"]), 4),
            "open":   round(float(row["Open"]), 4),
            "high":   round(float(row["High"]), 4),
            "low":    round(float(row["Low"]), 4),
            "volume": int(row["Volume"]),
            "signal": 0,
        }
        for date, row in df.iterrows()
    ]
    now_ts = _time.time()
    with _server_cache_lock:
        _server_cache[f"analyze:{sym}:{period}"] = {"val": analyze_val, "ts": now_ts}
        _server_cache[f"candles:{sym}:{period}"]  = {"val": {"symbol": sym, "period": period, "candles": rows}, "ts": now_ts}
    return len(rows)


def _prewarm():
    """
    Guarantee _server_cache is populated for the 5 core symbols before
    setting _prewarm_done=True. Two phases:
      1. Fast: read from SQLite (sub-second if data exists)
      2. Fallback: yfinance batch for any symbol not in SQLite
         (Render's SQLite is wiped on every cold start — always empty)
    Only after both phases succeed does /health return "ok", so the
    frontend gate never opens into an empty cache.
    """
    global _prewarm_done
    import yfinance as yf
    import pandas as pd
    from api.quant.ohlcv_store import _db_get, _db_put

    _WARM = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "SPY", "QQQ", "META", "GOOGL", "AMD"]
    period = "1y"
    needs_fetch = []

    # Phase 1 — SQLite fast path
    for sym in _WARM:
        try:
            cached = _db_get(sym, period, "1d")
            if cached is None:
                needs_fetch.append(sym)
                continue
            df, data_source = cached
            if df.empty or len(df) < 20:
                needs_fetch.append(sym)
                continue
            n = _cache_symbol(sym, period, df, data_source)
            print(f"[prewarm] {sym} ✓ SQLite ({n} candles)", flush=True)
        except Exception as e:
            print(f"[prewarm] {sym} SQLite error: {e}", flush=True)
            needs_fetch.append(sym)

    # Phase 2 — yfinance batch for anything SQLite didn't have
    if needs_fetch:
        print(f"[prewarm] SQLite cold — fetching {needs_fetch} via yfinance…", flush=True)
        try:
            raw = yf.download(
                tickers=needs_fetch, period=period, interval="1d",
                group_by="ticker", auto_adjust=True, progress=False, threads=True,
            )
            for sym in needs_fetch:
                try:
                    if len(needs_fetch) == 1:
                        df = raw.copy()
                        if isinstance(df.columns, pd.MultiIndex):
                            df.columns = df.columns.get_level_values(0)
                    else:
                        sym_u = sym.upper()
                        if sym_u not in raw.columns.get_level_values(0):
                            continue
                        df = raw[sym_u].dropna(how="all")
                    df = df.dropna(subset=["Close"])
                    if len(df) < 20:
                        continue
                    _db_put(sym, period, "1d", df, "yfinance")
                    n = _cache_symbol(sym, period, df, "yfinance")
                    print(f"[prewarm] {sym} ✓ yfinance ({n} candles)", flush=True)
                except Exception as e:
                    print(f"[prewarm] {sym} yfinance parse error: {e}", flush=True)
        except Exception as e:
            print(f"[prewarm] yfinance batch failed: {e}", flush=True)

    _prewarm_done = True
    print("[prewarm] done — /health now ok", flush=True)

    # Background: batch-fetch the full trading universe into SQLite so daytrade-picks
    # and analyze requests hit SQLite (instant) instead of live yfinance (slow).
    # Done in chunks of 200 to stay within yfinance batch limits.
    def _bg_refresh():
        global _bg_refresh_done
        import yfinance as yf
        from api.quant.ohlcv_store import _db_get
        from api.quant.sp500 import SP500_SYMBOLS
        from api.quant.nasdaq import NASDAQ_SYMBOLS

        period = "1y"
        # Full universe: SP500 + NASDAQ, deduped — these are what daytrade-picks scans
        seen: set[str] = set()
        universe: list[str] = []
        for sym in list(SP500_SYMBOLS) + list(NASDAQ_SYMBOLS):
            if sym not in seen:
                seen.add(sym)
                universe.append(sym)

        # Skip symbols already in SQLite (prewarm already handled the core 10)
        to_fetch = [s for s in universe if _db_get(s, period, "1d") is None]
        print(f"[bg_refresh] fetching {len(to_fetch)}/{len(universe)} symbols in chunks…", flush=True)

        CHUNK = 200  # yfinance handles up to ~200 per call comfortably
        stored = 0
        for i in range(0, len(to_fetch), CHUNK):
            chunk = to_fetch[i: i + CHUNK]
            try:
                raw = yf.download(
                    tickers=chunk, period=period, interval="1d",
                    group_by="ticker", auto_adjust=True, progress=False, threads=True,
                )
                if raw.empty:
                    continue

                items: list[tuple[str, "pd.DataFrame"]] = []
                for sym in chunk:
                    try:
                        sym_u = sym.upper()
                        if len(chunk) == 1:
                            df_raw = raw.copy()
                        else:
                            if sym_u not in raw.columns.get_level_values(0):
                                continue
                            df_raw = raw[sym_u].copy()
                        df = _clean_yf_df(df_raw)
                        if df.empty or len(df) < 20:
                            continue
                        items.append((sym_u, df))
                    except Exception:
                        pass

                if items:
                    _db_put_many(items, period, "1d", "yfinance")
                    stored += len(items)
            except Exception as e:
                print(f"[bg_refresh] chunk {i//CHUNK+1} failed: {e}", flush=True)
            # Brief pause between chunks — be a good citizen to yfinance
            if i + CHUNK < len(to_fetch):
                _time.sleep(3)

        _bg_refresh_done = True
        print(f"[bg_refresh] done — {stored}/{len(to_fetch)} symbols in SQLite", flush=True)

    _threading.Thread(target=_bg_refresh, daemon=True, name="bg-refresh").start()

_threading.Thread(target=_prewarm, daemon=True, name="prewarm").start()

def _cached(key: str, ttl: float, fn):
    """
    Stale-while-revalidate cache with non-blocking miss handling.

    Returns:
      dict/val  — real computed value (caller returns 200)
      _NO_DATA  — fn() returned None after completing (caller returns 404)
      None      — still computing after 7s wait (caller returns 503 "computing")

    All concurrent waiters on the same missing key share one compute thread via
    _compute_events — no duplicate yfinance downloads.
    """
    now = _time.time()
    with _server_cache_lock:
        entry = _server_cache.get(key)

    if entry is not None:
        age = now - entry["ts"]
        val = entry["val"]
        if age < ttl:
            return val   # fresh

        # Stale: return stale immediately, refresh in background
        # Don't refresh _NO_DATA entries for 5 minutes (avoid hammering yfinance on bad tickers)
        no_data_ttl = 300
        if val is _NO_DATA and age < no_data_ttl:
            return _NO_DATA
        with _server_cache_lock:
            if key not in _recomputing:
                _recomputing.add(key)
                def _bg(k=key, f=fn):
                    try:
                        v = f()
                        stored = v if v is not None else _NO_DATA
                        with _server_cache_lock:
                            _server_cache[k] = {"val": stored, "ts": _time.time()}
                    except Exception as e:
                        print(f"[_cached] stale refresh {k} error: {e}", flush=True)
                    finally:
                        with _server_cache_lock:
                            _recomputing.discard(k)
                            _compute_events.pop(k, None)
                _threading.Thread(target=_bg, daemon=True).start()
        return val

    # Cache miss — one thread computes, all concurrent callers share the event.
    ev: "_threading.Event | None" = None
    with _server_cache_lock:
        if key not in _recomputing:
            ev = _threading.Event()
            _compute_events[key] = ev
            _recomputing.add(key)

            def _compute_bg(k=key, f=fn, e=ev):
                try:
                    v = f()
                    stored = v if v is not None else _NO_DATA
                    with _server_cache_lock:
                        _server_cache[k] = {"val": stored, "ts": _time.time()}
                except Exception as ex:
                    print(f"[_cached] miss compute {k} error: {ex}", flush=True)
                finally:
                    with _server_cache_lock:
                        _recomputing.discard(k)
                        _compute_events.pop(k, None)
                    e.set()

            _threading.Thread(target=_compute_bg, daemon=True).start()
        else:
            ev = _compute_events.get(key)

    # Wait up to 7s (safely under Vercel's 10s kill timeout)
    if ev is not None:
        ev.wait(timeout=7.0)

    with _server_cache_lock:
        entry = _server_cache.get(key)
    if entry is not None:
        return entry["val"]   # _NO_DATA or real value
    return None  # still computing — caller returns 503


def _build_source_label(data_source: str, quote_source: str) -> str:
    """Convert internal source codes to a human-readable notification string."""
    _MAP = {
        "memory_cache":         "Memory cache",
        "sqlite_yfinance":      "Local cache (Yahoo Finance)",
        "sqlite_twelvedata":    "Local cache (TwelveData)",
        "yfinance":             "Yahoo Finance",
        "twelvedata":           "TwelveData",
        "none":                 "No data",
    }
    ohlcv = _MAP.get(data_source, data_source)
    quote = _MAP.get(quote_source, quote_source)
    if ohlcv == quote or "cache" in ohlcv.lower():
        return ohlcv
    return f"{ohlcv} (quote: {quote})"


@app.get("/health")
def health():
    # "warming" until background prewarm populates _server_cache.
    # The frontend wakeRender() polls this and only fires real API calls
    # once it sees "ok" — ensuring the first request is a cache hit.
    if _prewarm_done:
        return {"status": "ok", "universe_ready": _bg_refresh_done}
    return JSONResponse({"status": "warming", "universe_ready": False}, status_code=200)


@app.get("/api/data-source/status")
def data_source_status():
    """Return TwelveData and Alpha Vantage rate-limit state."""
    from api.quant.ohlcv_store import _av_calls_today, _AV_DAY_LIMIT, _AV_API_KEY
    td = get_td_state()
    av_configured = bool(_AV_API_KEY)
    return {
        "twelvedata": td,
        "alphavantage": {
            "configured":   av_configured,
            "calls_today":  _av_calls_today if av_configured else 0,
            "day_limit":    _AV_DAY_LIMIT,
            "calls_remaining": max(0, _AV_DAY_LIMIT - _av_calls_today) if av_configured else 0,
        },
        "cooldown_active":    td["cooldown_active"],
        "cooldown_remaining": td["cooldown_remaining"],
        "calls_today":        td["calls_today"],
        "message": (
            f"TwelveData on cooldown — {td['cooldown_remaining']}s until next allowed call. "
            f"Serving from local SQLite cache."
            if td["cooldown_active"] else
            "TwelveData available (Yahoo Finance primary; AlphaVantage bridge; TD last resort)."
        ),
    }


@app.post("/api/data-source/sweep")
def trigger_td_sweep(force: bool = False, period: str = "1y"):
    """
    Trigger a TwelveData bulk SP500 sweep in a background thread.
    force=true bypasses the 1-hour cooldown (use when yfinance is fully rate-limited).
    """
    def _run():
        result = td_bulk_sweep_now(period=period, force=force)
        print(f"[td_sweep] {result}", flush=True)

    t = _threading.Thread(target=_run, daemon=True, name="td-sweep-manual")
    t.start()
    td = get_td_state()
    return {
        "status": "started",
        "force": force,
        "period": period,
        "cooldown_remaining": td["cooldown_remaining"],
        "calls_today": td["calls_today"],
    }


@app.get("/api/analyze")
def analyze(symbol: str = "AAPL", period: str = "1y"):
    sym = symbol.upper()
    cache_key = f"analyze:{sym}:{period}"

    def _compute():
        df, data_source = fetch_with_source(sym, period=period, interval="1d")
        if df.empty:
            return None
        try:
            result = _engine.analyze(df, sym)
        except Exception as e:
            return {"error": str(e), "symbol": sym}
        quote, quote_source = fetch_quote_with_source(sym)
        return _build_analyze_val(result, quote, quote_source, data_source)

    val = _cached(cache_key, ttl=120, fn=_compute)
    if val is _NO_DATA:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    if val is None:
        return JSONResponse(
            {"error": "computing", "symbol": sym, "retry_after": 5},
            status_code=503, headers={"Retry-After": "5"},
        )
    return val


@app.get("/api/backtest")
def backtest(symbol: str = "AAPL", period: str = "1y", cash: float = 100_000):
    sym = symbol.upper()
    cache_key = f"backtest:{sym}:{period}"

    def _compute():
        df = fetch(sym, period=period, interval="1d")
        if df.empty:
            return None
        trader = PaperTrader(initial_cash=cash)
        return trader.run_backtest(df, sym)

    val = _cached(cache_key, ttl=600, fn=_compute)
    if val is None:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    return val


@app.get("/api/backtest/stress")
def backtest_stress(symbol: str = "AAPL", period: str = "5y", cash: float = 100_000):
    """Run the strategy across 5 auto-labelled market-regime slices of history."""
    sym = symbol.upper()
    cache_key = f"backtest_stress:{sym}:{period}"

    def _compute():
        df = fetch(sym, period=period, interval="1d")
        if df.empty:
            return None
        trader = PaperTrader(initial_cash=cash)
        return trader.run_stress_test(df, sym)

    val = _cached(cache_key, ttl=3600, fn=_compute)
    if val is None:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    return val


@app.get("/api/watchlist")
def watchlist(symbols: str = "AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,JPM,V,UNH,SPY,QQQ,BRK-B,JNJ,XOM"):
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:20]
    cache_key = f"watchlist:{'|'.join(sym_list)}"

    def _compute():
        results = []
        for sym in sym_list:
            df = fetch(sym, period="6mo", interval="1d")
            if df.empty:
                continue
            try:
                r = _engine.analyze(df, sym)
            except Exception:
                continue
            quote = fetch_quote(sym)
            results.append({
                "symbol":     sym,
                "price":      quote.get("price", 0),
                "change_pct": quote.get("change_pct", 0),
                "signal":     r.composite_signal,
                "confidence": r.composite_confidence,
                "regime":     r.regime,
                "rsi":        r.indicators.get("rsi_14", 50),
                "sharpe":     r.risk_metrics.get("sharpe", 0),
                "kelly_pct":  r.position_size_pct,
            })
        results.sort(key=lambda x: abs(x["confidence"]) * abs(x["signal"]), reverse=True)
        return {"watchlist": results}

    val = _cached(cache_key, ttl=300, fn=_compute)
    if val is None:
        return JSONResponse(
            {"error": "computing", "retry_after": 5},
            status_code=503, headers={"Retry-After": "5"},
        )
    return val


@app.get("/api/quote")
def quote(symbol: str = "AAPL"):
    return fetch_quote(symbol.upper())


@app.get("/api/broker/account")
def broker_account():
    a = get_account()
    if not a:
        return {"connected": False, "message": "Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env.local to connect your brokerage account."}
    from dataclasses import asdict
    return {"connected": True, **asdict(a)}

@app.get("/api/broker/positions")
def broker_positions():
    return {"positions": [p.__dict__ for p in get_positions()]}

@app.get("/api/broker/orders")
def broker_orders(status: str = "open"):
    return {"orders": [o.__dict__ for o in get_orders(status)]}

@app.post("/api/broker/orders")
async def broker_submit_order(request: Request):
    req = await request.json()
    return submit_order(
        symbol=req.get("symbol", ""),
        qty=float(req.get("qty", 0)),
        side=req.get("side", "buy"),
        order_type=req.get("order_type", "market"),
        limit_price=req.get("limit_price"),
        time_in_force=req.get("time_in_force", "day"),
    )

@app.delete("/api/broker/orders/{order_id}")
def broker_cancel_order(order_id: str):
    return cancel_order(order_id)

@app.get("/api/broker/orderbook")
def broker_orderbook(symbol: str = "AAPL"):
    ob = get_order_book(symbol)
    if not ob:
        # Return synthetic order book from yfinance when no Alpaca keys
        from api.quant.data import fetch_quote
        q = fetch_quote(symbol)
        price = q.get("price", 100)
        import random
        bids = [{"price": round(price - i*0.01, 2), "size": random.randint(100, 2000), "side": "buy"} for i in range(1, 21)]
        asks = [{"price": round(price + i*0.01, 2), "size": random.randint(100, 2000), "side": "sell"} for i in range(1, 21)]
        return {"symbol": symbol, "bids": bids, "asks": asks, "spread": 0.01, "mid_price": price, "best_bid": price-0.01, "best_ask": price+0.01, "synthetic": True}
    from dataclasses import asdict
    result = asdict(ob)
    result["synthetic"] = False
    return result

@app.get("/api/broker/bars")
def broker_bars(symbol: str = "AAPL", timeframe: str = "1Day", limit: int = 100):
    bars = get_bars(symbol, timeframe, limit)
    return {"bars": [b.__dict__ for b in bars]}

@app.get("/api/market/movers")
def market_movers(limit: int = 10):
    return get_market_movers(limit)

@app.get("/api/market/sectors")
def market_sectors():
    """Sector ETF performance snapshot — cached 60s."""
    import yfinance as yf
    SECTORS = {
        "Technology": "XLK", "Healthcare": "XLV", "Financials": "XLF",
        "Energy": "XLE", "Consumer Disc.": "XLY", "Industrials": "XLI",
        "Consumer Staples": "XLP", "Utilities": "XLU", "Real Estate": "XLRE",
        "Materials": "XLB", "Communication": "XLC"
    }
    def _fetch():
        tickers = yf.Tickers(" ".join(SECTORS.values()))
        results = []
        for name, etf in SECTORS.items():
            try:
                info = tickers.tickers[etf].fast_info
                price = float(info.last_price or 0)
                prev  = float(info.previous_close or price)
                chg   = ((price / prev) - 1) * 100 if prev else 0
                results.append({"name": name, "etf": etf, "price": round(price, 2), "change_pct": round(chg, 2)})
            except Exception:
                continue
        results.sort(key=lambda x: x["change_pct"], reverse=True)
        return {"sectors": results}
    return _cached("market_sectors", ttl=60, fn=_fetch)

@app.get("/api/market/indices")
def market_indices():
    """Major index levels — cached 30s."""
    import yfinance as yf
    INDICES = {"S&P 500": "^GSPC", "NASDAQ": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX"}
    def _fetch():
        tickers = yf.Tickers(" ".join(INDICES.values()))
        results = []
        for name, sym in INDICES.items():
            try:
                info = tickers.tickers[sym].fast_info
                price = float(info.last_price or 0)
                prev  = float(info.previous_close or price)
                chg   = ((price / prev) - 1) * 100 if prev else 0
                results.append({"name": name, "symbol": sym, "price": round(price, 2), "change_pct": round(chg, 2)})
            except Exception:
                continue
        return {"indices": results}
    return _cached("market_indices", ttl=30, fn=_fetch)


@app.get("/api/sp500/symbols")
def sp500_symbols():
    return {"symbols": SP500_SYMBOLS, "count": len(SP500_SYMBOLS)}

@app.get("/api/sp500/quotes")
def sp500_quotes(limit: int = 503, sort: str = "market_cap"):
    """
    Returns quotes for all S&P 500 stocks.
    sort: market_cap | change_pct_desc | change_pct_asc | alpha
    Cached 20s server-side. Fast: ~200ms after warm-up.
    """
    quotes = get_sp500_quotes()
    if sort == "change_pct_desc":
        quotes.sort(key=lambda x: x.get("change_pct", 0), reverse=True)
    elif sort == "change_pct_asc":
        quotes.sort(key=lambda x: x.get("change_pct", 0))
    elif sort == "alpha":
        quotes.sort(key=lambda x: x.get("symbol", ""))
    # default: market_cap (already sorted)
    return {"quotes": quotes[:limit], "total": len(quotes), "cached": True}

@app.get("/api/sp500/quote/{symbol}")
def sp500_single_quote(symbol: str):
    q = get_sp500_quote(symbol.upper())
    if not q:
        return JSONResponse({"error": "not_found", "symbol": symbol}, status_code=404)
    return q

@app.get("/api/sp500/heat")
def sp500_heat():
    """Heatmap data: symbol + change_pct + market_cap for all 503 stocks."""
    quotes = get_sp500_quotes()
    return {
        "heat": [
            {
                "symbol": q["symbol"],
                "change_pct": q.get("change_pct", 0),
                "market_cap": q.get("market_cap", 0),
                "price": q.get("price", 0),
            }
            for q in quotes
        ]
    }

@app.get("/api/sp500/screener")
def sp500_screener(
    min_change: float = -100,
    max_change: float = 100,
    sort: str = "change_pct_desc",
    limit: int = 50,
):
    """Filter and sort S&P 500 by % change. Used by the scanner."""
    quotes = get_sp500_quotes()
    filtered = [
        q for q in quotes
        if min_change <= q.get("change_pct", 0) <= max_change
    ]
    if sort == "change_pct_desc":
        filtered.sort(key=lambda x: x.get("change_pct", 0), reverse=True)
    elif sort == "change_pct_asc":
        filtered.sort(key=lambda x: x.get("change_pct", 0))
    elif sort == "alpha":
        filtered.sort(key=lambda x: x.get("symbol", ""))
    return {"results": filtered[:limit], "total_matched": len(filtered)}


@app.get("/api/scanner/quotes")
def scanner_quotes(universe: str = "both", limit: int = 1000, sort: str = "volume"):
    """
    Combined S&P500 + NASDAQ scanner quotes. Served instantly from cache.
    Adds vol_surge (today vol / 30d avg vol) and rs_rank (relative strength rank).
    universe: sp500 | nasdaq | both
    sort: volume | change_pct | rs_rank | vol_surge | market_cap
    """
    rows: list[dict] = []

    if universe in ("sp500", "both"):
        for q in get_sp500_quotes():
            rows.append({**q, "universe": "sp500"})

    if universe in ("nasdaq", "both"):
        for q in get_nasdaq_quotes():
            rows.append({**q, "universe": "nasdaq"})

    if not rows:
        return {"quotes": [], "total": 0, "universe": universe, "cached": True}

    # Deduplicate (NASDAQ module excludes S&P symbols, but guard anyway)
    seen: set[str] = set()
    deduped: list[dict] = []
    for q in rows:
        if q["symbol"] not in seen:
            seen.add(q["symbol"])
            deduped.append(q)
    rows = deduped

    # Compute relative-strength rank (percentile of change_pct within universe)
    changes = sorted(q.get("change_pct", 0) for q in rows)
    n = len(changes)
    for q in rows:
        c = q.get("change_pct", 0)
        rank = sum(1 for x in changes if x <= c) / n * 100
        q["rs_rank"] = round(rank, 1)

    # Volume surge: today vol / median vol of all stocks (proxy for unusual activity)
    vols = sorted(q.get("volume", 0) for q in rows if q.get("volume", 0) > 0)
    median_vol = vols[len(vols) // 2] if vols else 1
    for q in rows:
        q["vol_surge"] = round(q.get("volume", 0) / max(median_vol, 1), 2)

    # Sort
    if sort == "change_pct":
        rows.sort(key=lambda x: abs(x.get("change_pct", 0)), reverse=True)
    elif sort == "rs_rank":
        rows.sort(key=lambda x: x.get("rs_rank", 0), reverse=True)
    elif sort == "vol_surge":
        rows.sort(key=lambda x: x.get("vol_surge", 0), reverse=True)
    elif sort == "market_cap":
        rows.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
    else:  # volume
        rows.sort(key=lambda x: x.get("volume", 0), reverse=True)

    return {"quotes": rows[:limit], "total": len(rows), "universe": universe, "cached": True}


@app.get("/api/portfolio/risk")
def portfolio_risk(symbols: str = "AAPL,MSFT,NVDA", period: str = "1y"):
    """
    Correlation matrix + concentration metrics for a portfolio of symbols.
    Returns pairwise Pearson correlation on daily returns, plus:
      - diversification_score: 0–100 (100 = uncorrelated)
      - max_pairwise_corr: highest correlation between any two positions
      - avg_corr: mean pairwise correlation
      - beta_to_spy: portfolio-weighted beta vs SPY
    Cached 600s (correlations are stable intraday).
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:15]
    cache_key = f"portfolio_risk:{'|'.join(sym_list)}:{period}"

    def _compute():
        import pandas as pd
        frames = {}
        all_syms = sym_list + (["SPY"] if "SPY" not in sym_list else [])
        for sym in all_syms:
            df = fetch(sym, period=period, interval="1d")
            if not df.empty:
                frames[sym] = df["Close"].pct_change().dropna()

        if len(frames) < 2:
            return None

        # Align on common dates
        combined = pd.DataFrame(frames).dropna()
        if len(combined) < 20:
            return None

        # Correlation matrix (portfolio symbols only, not SPY)
        port_syms = [s for s in sym_list if s in combined.columns]
        if len(port_syms) < 2:
            return None

        corr = combined[port_syms].corr()

        # Pairwise stats
        pairs = []
        for i, a in enumerate(port_syms):
            for b in port_syms[i+1:]:
                pairs.append({"a": a, "b": b, "corr": round(float(corr.loc[a, b]), 3)})

        avg_corr = sum(p["corr"] for p in pairs) / len(pairs) if pairs else 0
        max_corr = max((p["corr"] for p in pairs), default=0)
        # Diversification score: 100 when avg_corr=0, 0 when avg_corr=1
        div_score = round(max(0, (1 - max(avg_corr, 0)) * 100), 1)

        # Beta vs SPY
        betas = {}
        if "SPY" in combined.columns:
            spy_var = float(combined["SPY"].var())
            for sym in port_syms:
                cov = float(combined[[sym, "SPY"]].cov().loc[sym, "SPY"])
                betas[sym] = round(cov / spy_var if spy_var > 0 else 1.0, 2)

        # Correlation matrix as list for JSON
        corr_matrix = {
            "symbols": port_syms,
            "values": [[round(float(corr.loc[a, b]), 3) for b in port_syms] for a in port_syms],
        }

        # Concentration warning
        warnings = []
        if max_corr > 0.85:
            high = [(p["a"], p["b"]) for p in pairs if p["corr"] > 0.85]
            for a, b in high:
                warnings.append(f"{a} and {b} are {corr.loc[a, b]:.0%} correlated — near-duplicate exposure.")
        if avg_corr > 0.7:
            warnings.append(f"Average pairwise correlation is {avg_corr:.0%} — portfolio is highly concentrated.")

        return {
            "symbols":           port_syms,
            "period":            period,
            "avg_corr":          round(avg_corr, 3),
            "max_pairwise_corr": round(max_corr, 3),
            "diversification_score": div_score,
            "pairs":             pairs,
            "corr_matrix":       corr_matrix,
            "betas":             betas,
            "warnings":          warnings,
        }

    val = _cached(cache_key, ttl=600, fn=_compute)
    if val is None:
        return JSONResponse({"error": "insufficient_data"}, status_code=422)
    return val


@app.get("/api/portfolio/backtest")
def portfolio_backtest(symbols: str = "AAPL,MSFT,NVDA", period: str = "1y", cash: float = 100_000):
    """
    Multi-symbol portfolio backtest: runs PaperTrader per symbol in parallel,
    then merges per-symbol equity curves into a single combined portfolio equity curve
    using capital-weighted allocation.

    Returns:
      - combined_curve: [{t, total, pnl_pct, drawdown}]
      - per_symbol: [{symbol, return, sharpe, n_trades, final_value}]
      - portfolio metrics (combined sharpe, max drawdown, total return, alpha vs SPY)
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:10]
    if not sym_list:
        return JSONResponse({"error": "no symbols"}, status_code=400)

    cache_key = f"portfolio_backtest:{'|'.join(sym_list)}:{period}:{int(cash)}"

    def _compute():
        import concurrent.futures
        import pandas as pd

        n = len(sym_list)
        per_cash = cash / n  # equal weight

        results: dict[str, dict] = {}

        def _run_one(sym: str) -> tuple[str, dict]:
            df = fetch(sym, period=period, interval="1d")
            if df.empty or len(df) < 65:
                return sym, {}
            trader = PaperTrader(initial_cash=per_cash)
            return sym, trader.run_backtest(df, sym)

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(n, 5)) as ex:
            for sym, res in ex.map(lambda s: _run_one(s), sym_list):
                if res and "snapshots" in res:
                    results[sym] = res

        if not results:
            return None

        # Merge equity curves: align on snapshot timestamps, sum total values
        # Each snapshot series: [{t, total, pnl_pct, drawdown, bnh_pct}]
        frames = {}
        for sym, r in results.items():
            snaps = r.get("snapshots", [])
            if snaps:
                frames[sym] = {s["t"][:10]: s["total"] for s in snaps}

        if not frames:
            return None

        # Find common dates
        date_sets = [set(v.keys()) for v in frames.values()]
        common_dates = sorted(set.intersection(*date_sets) if len(date_sets) > 1 else date_sets[0])

        if len(common_dates) < 5:
            # Fall back to union with forward-fill
            all_dates = sorted(set.union(*date_sets))
            common_dates = all_dates

        # Build combined curve
        # Fill missing dates in each series by forward-filling
        combined_curve = []
        initial_combined = per_cash * len(results)
        peak = initial_combined

        for date in common_dates:
            total = 0.0
            for sym, date_map in frames.items():
                # Walk backward to find last known value
                val = date_map.get(date)
                if val is None:
                    # take most recent prior date
                    prior = [v for d, v in sorted(date_map.items()) if d <= date]
                    val = prior[-1] if prior else per_cash
                total += val
            peak = max(peak, total)
            dd = (peak - total) / (peak + 1e-8) * 100
            pnl_pct = (total / initial_combined - 1) * 100
            combined_curve.append({
                "t":        date,
                "total":    round(total, 2),
                "pnl_pct":  round(pnl_pct, 3),
                "drawdown": round(dd, 3),
            })

        # Combined performance metrics
        totals = np.array([s["total"] for s in combined_curve])
        rets   = np.diff(totals) / (totals[:-1] + 1e-8)

        engine_metrics = PerformanceMetrics()
        combined_sharpe  = round(engine_metrics.sharpe(rets), 3) if len(rets) > 1 else 0.0
        combined_sortino = round(engine_metrics.sortino(rets), 3) if len(rets) > 1 else 0.0
        total_return     = round((totals[-1] / initial_combined - 1) * 100, 3) if len(totals) else 0.0
        max_dd           = round(engine_metrics.max_drawdown(totals) * 100, 3) if len(totals) else 0.0

        # SPY benchmark (buy-and-hold over same period)
        bnh_return = 0.0
        try:
            spy_df = fetch("SPY", period=period, interval="1d")
            if not spy_df.empty and len(spy_df) > 10:
                spy_start = float(spy_df["Close"].iloc[0])
                spy_end   = float(spy_df["Close"].iloc[-1])
                bnh_return = round((spy_end / spy_start - 1) * 100, 3)
        except Exception:
            pass

        alpha = round(total_return - bnh_return, 3)

        # Per-symbol summary
        per_symbol = []
        for sym, r in results.items():
            if "error" in r:
                continue
            per_symbol.append({
                "symbol":       sym,
                "total_return": r.get("total_return", 0),
                "sharpe":       r.get("sharpe", 0),
                "max_drawdown": r.get("max_drawdown", 0),
                "n_trades":     r.get("n_trades", 0),
                "win_rate":     r.get("win_rate", 0),
                "final_value":  r.get("final_value", per_cash),
                "alpha":        r.get("alpha", 0),
                "allocation":   round(per_cash / cash * 100, 1),
            })

        per_symbol.sort(key=lambda x: x["total_return"], reverse=True)

        return {
            "symbols":          sym_list,
            "period":           period,
            "initial_cash":     cash,
            "final_value":      round(float(totals[-1]), 2) if len(totals) else cash,
            "total_return":     total_return,
            "bnh_return":       bnh_return,
            "alpha":            alpha,
            "sharpe":           combined_sharpe,
            "sortino":          combined_sortino,
            "max_drawdown":     max_dd,
            "combined_curve":   combined_curve,
            "per_symbol":       per_symbol,
        }

    val = _cached(cache_key, ttl=300, fn=_compute)
    if val is None:
        return JSONResponse({"error": "insufficient_data"}, status_code=422)
    return val


@app.get("/api/signal-history")
def signal_history(symbol: str = "AAPL", period: str = "1y"):
    """
    Walk-forward signal history: signal, confidence, regime every ~2 weeks.
    For each point we also know the realized 10-bar return so we can show win/loss.
    Cached 300s — expensive (~20s) but only run on demand.
    """
    sym = symbol.upper()
    cache_key = f"signal_history:{sym}:{period}"

    def _compute():
        df = fetch(sym, period=period, interval="1d")
        if df.empty or len(df) < 70:
            return None

        WARMUP   = 60
        STEP     = 10   # sample every 10 bars (~2 weeks)
        FWDLOOK  = 10   # bars ahead to measure outcome

        records = []
        closes = df["Close"].values
        dates  = [str(d)[:10] for d in df.index]

        for i in range(WARMUP, len(df) - FWDLOOK, STEP):
            window = df.iloc[:i]
            try:
                r = _engine.analyze(window, sym)
            except Exception:
                continue

            price_now  = float(closes[i])
            price_fwd  = float(closes[i + FWDLOOK])
            fwd_return = (price_fwd - price_now) / price_now * 100

            # Outcome: did the signal direction match the next 10-bar price move?
            sig = r.composite_signal
            if sig == 1:
                outcome = "win" if fwd_return > 0.5 else ("loss" if fwd_return < -0.5 else "neutral")
            elif sig == -1:
                outcome = "win" if fwd_return < -0.5 else ("loss" if fwd_return > 0.5 else "neutral")
            else:
                outcome = "neutral"

            records.append({
                "date":       dates[i],
                "signal":     sig,
                "confidence": round(r.composite_confidence, 3),
                "regime":     r.regime,
                "price":      round(price_now, 2),
                "fwd_return": round(fwd_return, 2),
                "outcome":    outcome,
            })

        if not records:
            return None

        # Aggregate stats
        executed = [r for r in records if r["signal"] != 0]
        wins     = [r for r in executed if r["outcome"] == "win"]
        win_rate = round(len(wins) / len(executed) * 100, 1) if executed else 0

        return {
            "symbol":    sym,
            "period":    period,
            "records":   records[-30:],   # last 30 signal points
            "total":     len(executed),
            "win_rate":  win_rate,
            "wins":      len(wins),
            "losses":    len([r for r in executed if r["outcome"] == "loss"]),
        }

    val = _cached(cache_key, ttl=300, fn=_compute)
    if val is None:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    return val


@app.get("/api/leaderboard")
def leaderboard(horizon: str = "swing"):
    """
    Signal leaderboard: aggregated win-rate and avg return across 20 core symbols
    over the past year. Cached 1 hour — expensive but rare.
    """
    import concurrent.futures

    CORE_SYMBOLS = [
        "AAPL", "NVDA", "MSFT", "GOOGL", "META", "AMZN", "TSLA",
        "AMD", "NFLX", "JPM", "BAC", "GS", "ORCL", "ADBE", "CRM",
        "SPY", "QQQ", "XLK", "XLF", "COST",
    ]
    cache_key = f"leaderboard:{horizon}"

    def _compute():
        WARMUP = 60; STEP = 10; FWDLOOK = 10
        rows = []

        def _do_one(sym: str):
            try:
                df = fetch(sym, period="1y", interval="1d")
                if df.empty or len(df) < 80:
                    return None
                closes = df["Close"].values
                dates  = [str(d)[:10] for d in df.index]
                executed, wins, losses, rets = 0, 0, 0, []
                for i in range(WARMUP, len(df) - FWDLOOK, STEP):
                    window = df.iloc[:i]
                    try:
                        r = _engine.analyze(window, sym, horizon=horizon)
                    except Exception:
                        continue
                    sig = r.composite_signal
                    if sig == 0:
                        continue
                    price_now = float(closes[i])
                    price_fwd = float(closes[i + FWDLOOK])
                    fwd_ret = (price_fwd - price_now) / price_now * 100
                    directed = fwd_ret if sig == 1 else -fwd_ret
                    executed += 1
                    rets.append(directed)
                    if directed > 0.5:
                        wins += 1
                    elif directed < -0.5:
                        losses += 1
                if executed == 0:
                    return None
                return {
                    "symbol":       sym,
                    "horizon":      horizon,
                    "signals":      executed,
                    "wins":         wins,
                    "losses":       losses,
                    "win_rate":     round(wins / max(wins + losses, 1) * 100, 1),
                    "avg_return":   round(sum(rets) / len(rets), 2),
                    "last_updated": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
                }
            except Exception:
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for item in ex.map(_do_one, CORE_SYMBOLS):
                if item is not None:
                    rows.append(item)

        rows.sort(key=lambda x: x["win_rate"], reverse=True)
        return {
            "horizon": horizon,
            "rows": rows,
            "symbols_scored": len(rows),
            "generated_at": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        }

    val = _cached(cache_key, ttl=3600, fn=_compute)
    if val is None:
        return JSONResponse({"error": "computing", "retry_after": 60}, status_code=503, headers={"Retry-After": "60"})
    return val


@app.get("/api/daytrade-picks")
def daytrade_picks(limit: int = 20, universe: str = "sp500",
                   horizon: str = DEFAULT_HORIZON,
                   include_shorts: bool = False,
                   beginner: bool = False):
    """
    Rank S&P 500 symbols by expected return for the chosen trading horizon.

    Horizons:
      day     — intraday/overnight, 1-2 day hold. Uses ATR, volume surge, intraday momentum.
      swing   — 1–4 week hold. EMA crossovers, RSI reversion, MACD.
      month   — 1–3 month. Trend quality, Sharpe, MC probability.
      quarter — 3–6 month. Price momentum, sector rotation.
      year    — 6–12 month. Jegadeesh-Titman 12-1mo momentum, Hurst persistence.

    Algorithm:
      1. Pull today's price snapshot for all ~503 S&P 500 symbols (cached 20s).
      2. Fetch historical data scaled to the horizon (6mo for day/swing/month, 1y for longer).
      3. Run QuantEngine.analyze(horizon=...) with horizon-specific signals & scoring.
      4. Rank by horizon_score (horizon-tuned composite; see engine.py).

    Cached 300s per horizon — ~25s cold, instant warm.
    """
    if horizon not in HORIZONS:
        return JSONResponse({"error": f"horizon must be one of {list(HORIZONS)}"}, status_code=422)

    # Refuse to scan before SQLite is populated — scanning 80–150 symbols via
    # live yfinance (single-symbol per request) would blow through the 7s window.
    if not _bg_refresh_done:
        return JSONResponse(
            {"error": "computing", "retry_after": 30,
             "message": "Universe data loading — retry in 30s"},
            status_code=503, headers={"Retry-After": "30"},
        )

    cache_key = f"daytrade_picks:{universe}:{limit}:{horizon}:{include_shorts}"
    data_period = HORIZONS[horizon]["period"]
    horizon_label = HORIZONS[horizon]["label"]

    # Minimum confidence thresholds per horizon (longer horizons = stricter filter)
    MIN_CONF = {
        "day":     0.42,
        "swing":   0.45,
        "month":   0.48,
        "quarter": 0.50,
        "year":    0.52,
    }
    min_conf = MIN_CONF.get(horizon, 0.45)

    def _compute():
        import concurrent.futures

        # Step 1: get quote snapshot for the requested universe
        if universe == "nasdaq":
            quotes = get_nasdaq_quotes()   # sorted by volume desc
        elif universe == "both":
            sp_q    = get_sp500_quotes()
            nq_q    = get_nasdaq_quotes()
            seen    = set()
            quotes  = []
            for q in sp_q + nq_q:
                sym = q["symbol"]
                if sym not in seen:
                    seen.add(sym)
                    quotes.append(q)
        else:
            quotes = get_sp500_quotes()    # default: S&P 500, sorted by market_cap

        # Filter to liquid stocks (price > $5, some volume)
        min_vol = 10_000 if horizon in ("day", "swing") else 5_000
        candidates = [
            q for q in quotes
            if q.get("price", 0) >= 5 and q.get("volume", 0) > min_vol
        ]

        # Scan more candidates when using NASDAQ (find hidden gems beyond large-caps)
        if universe == "nasdaq":
            scan_limit = min(120, len(candidates))   # 120 for NASDAQ — more diverse
        elif universe == "both":
            scan_limit = min(150, len(candidates))
        else:
            scan_limit = min(80, len(candidates))    # original S&P 500 limit
        to_scan = candidates[:scan_limit]

        results = []

        def _analyse_one(q: dict):
            sym = q["symbol"]
            try:
                df = fetch(sym, period=data_period, interval="1d")
                min_bars = 65 if data_period == "6mo" else 120
                if df.empty or len(df) < min_bars:
                    return None
                r = _engine.analyze(df, sym, horizon=horizon)
                sig = r.composite_signal
                # Always require meaningful confidence; include shorts only when requested
                if r.composite_confidence < min_conf:
                    return None
                if sig == 0:
                    return None
                if sig == -1 and not include_shorts:
                    return None
                direction = "long" if sig == 1 else "short"
                return {
                    "rank":               0,  # filled after sort
                    "symbol":             sym,
                    "direction":          direction,
                    "price":              q.get("price", r.indicators.get("price", 0)),
                    "change_pct":         round(q.get("change_pct", 0), 2),
                    "score":              round(r.horizon_score, 6),
                    "confidence":         round(r.composite_confidence, 4),
                    "expected_return":    round(r.expected_return, 4),
                    "position_size_pct":  round(r.position_size_pct, 2),
                    "regime":             r.regime,
                    "horizon":            r.horizon,
                    "rsi":                round(r.indicators.get("rsi_14", 50), 1),
                    "sharpe":             round(r.risk_metrics.get("sharpe", 0), 2),
                    "max_drawdown":       round(r.risk_metrics.get("max_drawdown", 0), 4),
                    "mc_prob_positive":   round(r.monte_carlo.get("prob_positive", 50), 1),
                    "hurst":              round(r.indicators.get("hurst", 0.5), 3),
                    "vol_adv_ratio":      round(r.indicators.get("vol_adv_ratio", 1.0), 2),
                    "atr_pct":            round(r.indicators.get("atr_pct", 0), 3),
                    "mom_12_1":           round(r.indicators.get("mom_12_1", 0), 2),
                    "mom_3":              round(r.indicators.get("mom_3", 0), 2),
                    "ret_5d":             round(r.indicators.get("ret_5d", 0), 2),
                    "sub_signals": [
                        {
                            "source":     s.source,
                            "direction":  s.direction,
                            "confidence": round(s.confidence, 3),
                        }
                        for s in r.signals if s.direction == sig
                    ],
                }
            except Exception:
                return None

        # 4 workers: enough parallelism without hammering yfinance rate limits
        # when SQLite is cold (after bg_refresh finishes this becomes instant)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for item in ex.map(_analyse_one, to_scan):
                if item is not None:
                    results.append(item)

        longs  = [r for r in results if r["direction"] == "long"]
        shorts = [r for r in results if r["direction"] == "short"]

        # Sort each group by abs(score) descending, then interleave for mixed output
        longs.sort(key=lambda x: abs(x["score"]), reverse=True)
        shorts.sort(key=lambda x: abs(x["score"]), reverse=True)

        if include_shorts:
            # Interleave: take alternating long/short up to limit
            top: list[dict] = []
            li = si = 0
            while len(top) < limit and (li < len(longs) or si < len(shorts)):
                if li < len(longs):
                    top.append(longs[li]); li += 1
                if len(top) < limit and si < len(shorts):
                    top.append(shorts[si]); si += 1
        else:
            top = longs[:limit]

        # Assign ranks 1..N
        for i, item in enumerate(top):
            item["rank"] = i + 1

        return {
            "picks":          top,
            "total_picks":    len(top),
            "scanned_long":   len(longs),
            "scanned_short":  len(shorts),
            "scanned_total":  scan_limit,
            "horizon":        horizon,
            "horizon_label":  horizon_label,
            "generated_at":   _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        }

    val = _cached(cache_key, ttl=900, fn=_compute)
    if val is None:
        return JSONResponse(
            {"error": "computing", "retry_after": 5},
            status_code=503,
            headers={"Retry-After": "5"},
        )

    # Server-side beginner filter: stricter safety constraints
    if beginner and val and "picks" in val:
        raw_picks = val["picks"]
        filtered = [
            p for p in raw_picks
            if p.get("confidence", 0) >= 0.55           # minimum conviction
            and p.get("max_drawdown", 1.0) <= 0.25      # max 25% historical drawdown
            and p.get("sharpe", 0) >= 0.4               # minimum risk-adjusted return
            and p.get("price", 0) >= 10.0               # no penny stocks
            and p.get("direction") == "long"             # longs only in beginner mode
        ]
        return {
            **val,
            "picks": filtered[:limit],
            "total_picks": len(filtered[:limit]),
            "beginner_filtered": True,
            "beginner_total_before_filter": len(raw_picks),
        }
    return val


@app.get("/api/chart-data/{symbol}")
def chart_data(symbol: str, period: str = "6mo"):
    """
    Return chart candles for a symbol. Serves from SQLite cache; fetches on-demand
    if not cached (using yfinance batch — zero TwelveData spend). Period: 6mo|3mo|1w.
    """
    sym = symbol.upper()
    allowed = {"6mo", "3mo", "1w"}
    if period not in allowed:
        return JSONResponse({"error": f"period must be one of {sorted(allowed)}"}, status_code=422)

    # Try cache first (instant)
    candles_data = get_chart(sym, period)
    if candles_data is not None:
        return {"symbol": sym, "period": period, "candles": candles_data}

    # On-demand fetch (yfinance only — no TwelveData)
    all_periods = ensure_chart(sym)
    if all_periods is None:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)

    return {"symbol": sym, "period": period, "candles": all_periods.get(period, [])}


@app.get("/api/charts/sweep")
def charts_sweep(force: bool = False):
    """
    GET  — returns current sweep status (symbols cached, age, stale flag).
    GET ?force=true — triggers a new sweep even if cache is fresh.
    Sweep uses yfinance batch download only — zero TwelveData spend.
    """
    if force or sweep_is_stale():
        # Use static SP500 list — no live API call needed to get symbol list
        symbols = SP500_SYMBOLS[:80]
        sweep_result = run_sweep(symbols, force=force)
        status = get_sweep_status()
        return {**status, "trigger": sweep_result}

    return get_sweep_status()


@app.get("/api/charts/batch")
def charts_batch(symbols: str = "", period: str = "6mo"):
    """
    Return chart data for multiple symbols in one call.
    symbols: comma-separated list, e.g. "AAPL,MSFT,NVDA"
    period: "6mo" | "3mo" | "1w"
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return JSONResponse({"error": "symbols param is required"}, status_code=422)

    batch = get_charts_batch(sym_list, period)
    return {"period": period, "charts": batch, "found": len(batch), "requested": len(sym_list)}


@app.get("/api/candles")
def candles(symbol: str = "AAPL", period: str = "1y"):
    """OHLC price series. Signals from backtest are reused if already cached; skipped otherwise."""
    sym = symbol.upper()
    cache_key = f"candles:{sym}:{period}"

    def _compute():
        df = fetch(sym, period=period, interval="1d")
        if df.empty:
            return None

        # Reuse backtest fills only if a prior backtest result is already in cache
        signal_map: dict[str, int] = {}
        backtest_cache_key = f"backtest:{sym}:{period}"
        with _server_cache_lock:
            bt_entry = _server_cache.get(backtest_cache_key)
        if bt_entry:
            for fill in bt_entry["val"].get("fills", []):
                date_str = str(fill["ts"])[:10]
                signal_map[date_str] = 1 if fill["side"] == "buy" else -1

        rows = []
        for date, row in df.iterrows():
            date_str = str(date)[:10]
            rows.append({
                "date":   date_str,
                "price":  round(float(row["Close"]), 4),
                "open":   round(float(row["Open"]), 4),
                "high":   round(float(row["High"]), 4),
                "low":    round(float(row["Low"]), 4),
                "volume": int(row["Volume"]),
                "signal": signal_map.get(date_str, 0),
            })
        return {"symbol": sym, "period": period, "candles": rows}

    val = _cached(cache_key, ttl=120, fn=_compute)
    if val is _NO_DATA:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    if val is None:
        return JSONResponse(
            {"error": "computing", "symbol": sym, "retry_after": 5},
            status_code=503, headers={"Retry-After": "5"},
        )
    return val



# ── Agent endpoints ───────────────────────────────────────────────────────────

@app.get("/api/agent/config")
def agent_config():
    return _agent.get_config()

@app.post("/api/agent/config")
async def agent_config_update(request: Request):
    body = await request.json()
    return _agent.set_config(body)

@app.get("/api/agent/export")
def agent_export():
    """Return a portable JSON blob of the current agent config (safe to share)."""
    import json as _json, base64 as _b64
    cfg = _agent.get_config()
    # Strip sensitive fields before exporting
    cfg.pop("notify_email", None)
    blob = _b64.urlsafe_b64encode(_json.dumps(cfg).encode()).decode()
    return {"config": cfg, "blob": blob}

@app.post("/api/agent/import")
async def agent_import(request: Request):
    """Apply a shared agent config blob (base64 or raw JSON object)."""
    import json as _json, base64 as _b64
    body = await request.json()
    raw = body.get("blob") or body.get("config")
    if isinstance(raw, str):
        try:
            decoded = _json.loads(_b64.urlsafe_b64decode(raw + "=="))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid config blob")
    elif isinstance(raw, dict):
        decoded = raw
    else:
        raise HTTPException(status_code=400, detail="Provide 'blob' (base64 str) or 'config' (object)")
    # Whitelist safe keys — never let import overwrite runtime-only state
    safe_keys = {"enabled", "dry_run", "symbols", "horizon", "min_confidence",
                 "kelly_cap_pct", "daily_loss_cap_pct", "max_concentration_pct",
                 "poll_interval_min", "allow_short"}
    filtered = {k: v for k, v in decoded.items() if k in safe_keys}
    return _agent.set_config(filtered)

@app.get("/api/agent/status")
def agent_status():
    return _agent.get_status()


@app.get("/api/agent/stream")
async def agent_stream(request: Request):
    """
    Server-Sent Events stream for real-time agent status.
    Emits whenever journal count changes (trade fired) or running state changes.
    Falls back to a heartbeat every 30s.
    """
    import asyncio
    import json as _json

    async def _generator():
        last_count = -1
        last_running = None
        while not await request.is_disconnected():
            try:
                state = _agent.get_status()
                count = state.get("journal_count", 0)
                running = state.get("running", False)
                # Emit on first connect and on any state change
                if count != last_count or running != last_running:
                    last_count = count
                    last_running = running
                    yield f"data: {_json.dumps(state)}\n\n"
                else:
                    # Heartbeat to keep connection alive
                    yield ": heartbeat\n\n"
            except Exception:
                yield ": error\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/agent/run")
def agent_run():
    """Trigger one synchronous execution cycle — returns summary."""
    return _agent.run_once()

@app.get("/api/agent/journal")
def agent_journal(limit: int = 50):
    return {"journal": _agent.get_journal(limit), "total": len(_agent._state.journal)}

@app.get("/api/agent/digest")
def agent_digest():
    """Morning digest: latest signal + sentiment for each watched symbol."""
    return _cached("agent_digest", ttl=300, fn=_agent.get_digest)


@app.get("/api/agent/track-record")
def agent_track_record():
    """Live signal outcome log — win/loss on trades the agent actually fired."""
    return _agent.get_track_record()


@app.get("/api/circuit-breaker")
def circuit_breaker_status():
    """Current state of the account-level circuit breaker."""
    from api.quant.circuit_breaker import get_status
    return get_status()


@app.post("/api/circuit-breaker/configure")
async def circuit_breaker_configure(request: Request):
    """Update circuit breaker config (threshold_pct, notify_email)."""
    from api.quant.circuit_breaker import configure
    body = await request.json()
    return configure(
        threshold_pct=body.get("threshold_pct"),
        notify_email=body.get("notify_email"),
    )


@app.post("/api/circuit-breaker/reset")
def circuit_breaker_reset():
    """Manually clear a tripped circuit breaker after reviewing the situation."""
    from api.quant.circuit_breaker import reset
    return reset()


@app.post("/api/circuit-breaker/check")
def circuit_breaker_check():
    """Force an immediate equity check. Returns current breaker state."""
    from api.quant.circuit_breaker import check_and_trip, get_status
    check_and_trip()
    return get_status()


@app.get("/api/agent/debrief/{trade_id:path}")
def agent_debrief(trade_id: str):
    """
    Post-trade debrief for a single journal entry.
    trade_id = the entry's ts field (ISO timestamp), URL-encoded by the client.
    Returns plain-English analysis: what happened vs expected, which signals fired,
    whether they were right, and a one-sentence summary.
    """
    result = _agent.get_debrief(trade_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── Intraday agent endpoints ──────────────────────────────────────────────────

@app.post("/api/intraday/start")
async def intraday_start(request: Request):
    """
    Start an intraday session.
    Body: { symbol, direction (1 or -1), account_size, risk_per_trade_pct?,
            max_trades?, dry_run? }
    """
    from api.quant.intraday_agent import get_agent, IntradayConfig
    body = await request.json()
    try:
        cfg = IntradayConfig(
            symbol             = str(body.get("symbol", "")).upper().strip(),
            direction          = int(body.get("direction", 1)),
            account_size       = float(body.get("account_size", 10_000)),
            risk_per_trade_pct = float(body.get("risk_per_trade_pct", 1.0)),
            stop_atr_mult      = float(body.get("stop_atr_mult", 1.5)),
            max_trades         = int(body.get("max_trades", 5)),
            dry_run            = bool(body.get("dry_run", True)),
            notify_email       = str(body.get("notify_email", "")).strip(),
        )
        if not cfg.symbol:
            raise ValueError("symbol is required")
        if cfg.direction not in (1, -1):
            raise ValueError("direction must be 1 (LONG) or -1 (SHORT)")
        if cfg.risk_per_trade_pct < 0.5 or cfg.risk_per_trade_pct > 2.0:
            raise ValueError("risk_per_trade_pct must be between 0.5% and 2.0%")

        # Buying power check for live sessions — compare max possible position size
        # against actual Alpaca account buying power to catch mismatched account inputs.
        if not cfg.dry_run:
            from api.quant.broker import get_account
            acct = get_account()
            if acct is not None:
                # Max position = 20% of account (position size cap in _compute_qty)
                max_position_dollars = cfg.account_size * 0.20
                if max_position_dollars > acct.buying_power:
                    raise ValueError(
                        f"Insufficient buying power: session account_size ${cfg.account_size:,.0f} implies "
                        f"a max position of ${max_position_dollars:,.0f}, but your Alpaca account only has "
                        f"${acct.buying_power:,.2f} in buying power. "
                        f"Lower account_size to ≤${acct.buying_power * 5:,.0f} or fund your account."
                    )

        get_agent().start(cfg)
        return {"ok": True, "symbol": cfg.symbol, "direction": cfg.direction, "dry_run": cfg.dry_run}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/intraday/stop")
def intraday_stop():
    """Stop the intraday agent (force-closes any open position first)."""
    from api.quant.intraday_agent import get_agent
    get_agent().stop()
    return {"ok": True}


@app.get("/api/intraday/status")
def intraday_status():
    """Current intraday agent status, live trade log, P&L."""
    from api.quant.intraday_agent import get_agent
    return get_agent().get_status()


@app.get("/api/intraday/history")
def intraday_history(limit: int = Query(default=30, ge=1, le=100)):
    """Cross-session track record: each past session's symbol, direction, trades, P&L, max drawdown."""
    from api.quant.intraday_agent import get_session_history
    return {"sessions": get_session_history(limit=limit)}


# ── NASDAQ endpoints ──────────────────────────────────────────────────────────

@app.get("/api/nasdaq/symbols")
def nasdaq_symbols_endpoint():
    return {"symbols": NASDAQ_SYMBOLS, "count": len(NASDAQ_SYMBOLS)}

@app.get("/api/nasdaq/quotes")
def nasdaq_quotes_endpoint(limit: int = 200):
    quotes = get_nasdaq_quotes()
    return {"quotes": quotes[:limit], "total": len(quotes), "cached": True}


# ── Options endpoints ─────────────────────────────────────────────────────────

@app.get("/api/options/chain")
def options_chain(symbol: str = "AAPL", force: bool = False):
    """
    Return the full options chain for a symbol (calls + puts, up to 4 expiries).
    Cached 5 minutes. Includes IV rank, ATM IV, and historical vol.
    Source: yfinance option_chain() — free, covers all optionable US stocks.
    """
    from api.quant.options import get_chain, chain_to_dict
    sym = symbol.upper()
    cache_key = f"options_chain:{sym}"
    def _compute():
        chain = get_chain(sym, force=force)
        if chain is None:
            return None
        return chain_to_dict(chain)
    val = _cached(cache_key, ttl=300, fn=_compute)
    if val is None:
        return JSONResponse(
            {"error": "no_options_data", "symbol": sym,
             "message": "No options chain available. The stock may not have listed options, or yfinance is rate-limited. Try again in 30s."},
            status_code=404
        )
    return val


@app.get("/api/options/signal")
def options_signal(
    symbol: str = "AAPL",
    horizon: str = DEFAULT_HORIZON,
    portfolio_value: float = 10_000,
):
    """
    Translate the quant engine's directional signal into a specific option recommendation.

    Returns:
      - strategy:         "buy_call" | "buy_put" | "bull_call_spread" | "bear_put_spread"
      - contract:         the recommended option (strike, expiry, Greeks, bid/ask)
      - spread_short_leg: short leg for spreads (null for outright)
      - max_profit / max_loss / breakeven / prob_profit
      - iv_environment:   "cheap" | "fair" | "expensive"
      - rationale:        plain-English explanation
      - recommended_qty:  contracts (based on 1.5% portfolio risk budget)
    """
    from api.quant.options import get_chain, signal_to_options, options_signal_to_dict
    sym = symbol.upper()
    if horizon not in HORIZONS:
        return JSONResponse({"error": f"horizon must be one of {list(HORIZONS)}"}, status_code=422)

    cache_key = f"options_signal:{sym}:{horizon}"

    def _compute():
        # Get directional signal from quant engine
        df = fetch(sym, period=HORIZONS[horizon]["period"], interval="1d")
        if df.empty:
            return None
        r = _engine.analyze(df, sym, horizon=horizon)
        if r.composite_signal == 0:
            return {
                "symbol": sym,
                "signal": 0,
                "signal_word": "neutral",
                "confidence": round(r.composite_confidence, 4),
                "horizon": horizon,
                "recommendation": None,
                "message": "No directional signal — no options trade recommended.",
            }

        # Fetch options chain
        chain = get_chain(sym)
        if chain is None:
            return {
                "symbol": sym,
                "signal": r.composite_signal,
                "signal_word": "long" if r.composite_signal == 1 else "short",
                "confidence": round(r.composite_confidence, 4),
                "horizon": horizon,
                "recommendation": None,
                "message": "Options chain unavailable for this symbol.",
            }

        rec = signal_to_options(chain, r.composite_signal, r.composite_confidence,
                                horizon=horizon, portfolio_value=portfolio_value)
        return {
            "symbol":       sym,
            "signal":       r.composite_signal,
            "signal_word":  "long" if r.composite_signal == 1 else "short",
            "confidence":   round(r.composite_confidence, 4),
            "regime":       r.regime,
            "horizon":      horizon,
            "horizon_label": HORIZONS[horizon]["label"],
            "underlying_price": chain.underlying_price,
            "iv_rank":      chain.iv_rank,
            "atm_iv":       round(chain.atm_iv * 100, 1),
            "hist_vol":     round(chain.hist_vol_30d * 100, 1),
            "recommendation": options_signal_to_dict(rec),
        }

    val = _cached(cache_key, ttl=180, fn=_compute)
    if val is None:
        return JSONResponse({"error": "no_data", "symbol": sym}, status_code=404)
    return val


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787, log_level="info")
