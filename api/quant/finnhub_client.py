"""
Finnhub API client — free-tier endpoints only.

Free tier confirmed working:
  - /quote                      real-time price
  - /stock/metric               fundamentals (PE, beta, 52w hi/lo, growth, ROE...)
  - /stock/recommendation       analyst buy/hold/sell consensus
  - /stock/earnings             earnings surprise history (last 4 quarters)
  - /calendar/earnings          upcoming earnings dates + EPS estimates
  - /stock/insider-sentiment    MSPR monthly insider buying pressure
  - /stock/insider-transactions individual insider trade disclosures
  - /company-news               symbol-level news feed
  - /news                       market-wide news
  - /stock/peers                peer tickers
  - /stock/social-sentiment     Reddit/Twitter mention scores
  - /calendar/economic          macro event calendar
  - /stock/congressional-trading congressional buy/sell disclosures
  - /stock/earnings-quality-score earnings manipulation risk score
  - /stock/profile2             company profile (sector, mkt cap, logo)

Rate limit: 60 calls/minute free tier — all results cached aggressively.
"""

import os
import time
import threading
import logging
import requests
from datetime import datetime, date, timedelta
from typing import Optional

log = logging.getLogger("finnhub")

_API_KEY = os.environ.get("FINNHUB_API_KEY", "d8vdjrpr01qgrv4nbpn0d8vdjrpr01qgrv4nbpng")
_BASE = "https://finnhub.io/api/v1"
_TIMEOUT = 10

# ── Rate limiter: 60 calls/min, 30/s burst ───────────────────────────────────
_rate_lock = threading.Lock()
_call_times: list[float] = []
_MIN_INTERVAL = 1.1  # minimum seconds between calls (safe margin under 30/s)


def _rate_limited_get(path: str, params: dict) -> Optional[dict]:
    """GET with rate limiting and error handling. Returns None on any failure."""
    global _call_times
    params["token"] = _API_KEY

    with _rate_lock:
        now = time.time()
        # Remove calls older than 60s from the window
        _call_times = [t for t in _call_times if now - t < 60]
        if len(_call_times) >= 55:  # stay under 60/min cap
            oldest = _call_times[0]
            wait = 60 - (now - oldest) + 0.1
            if wait > 0:
                time.sleep(wait)
        # Enforce minimum inter-call interval
        if _call_times and (now - _call_times[-1]) < _MIN_INTERVAL:
            time.sleep(_MIN_INTERVAL - (now - _call_times[-1]))
        _call_times.append(time.time())

    try:
        resp = requests.get(f"{_BASE}{path}", params=params, timeout=_TIMEOUT)
        if resp.status_code == 429:
            log.warning("Finnhub rate limit hit — sleeping 61s")
            time.sleep(61)
            return None
        if resp.status_code != 200:
            log.debug("Finnhub %s HTTP %s", path, resp.status_code)
            return None
        data = resp.json()
        if isinstance(data, dict) and "error" in data:
            log.debug("Finnhub %s error: %s", path, data["error"])
            return None
        return data
    except Exception as e:
        log.debug("Finnhub %s: %s", path, type(e).__name__)
        return None


# ── In-memory cache (avoids hammering Finnhub on repeated requests) ──────────
_cache: dict[str, tuple[any, float]] = {}
_cache_lock = threading.Lock()


def _cached(key: str, ttl: float, fn) -> Optional[any]:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry[1]) < ttl:
            return entry[0]
    result = fn()
    if result is not None:
        with _cache_lock:
            _cache[key] = (result, time.time())
    return result


# ── Public API ────────────────────────────────────────────────────────────────

def get_quote(symbol: str) -> Optional[dict]:
    """Real-time quote: price, change, % change, high, low, open, prev_close."""
    def _fetch():
        d = _rate_limited_get("/quote", {"symbol": symbol})
        if not d or d.get("c", 0) == 0:
            return None
        return {
            "price":      round(float(d["c"]), 2),
            "change":     round(float(d.get("d", 0)), 2),
            "change_pct": round(float(d.get("dp", 0)), 4),
            "high":       round(float(d.get("h", 0)), 2),
            "low":        round(float(d.get("l", 0)), 2),
            "open":       round(float(d.get("o", 0)), 2),
            "prev_close": round(float(d.get("pc", 0)), 2),
            "timestamp":  d.get("t", 0),
            "source":     "finnhub",
        }
    return _cached(f"quote:{symbol}", 60, _fetch)


def get_fundamentals(symbol: str) -> Optional[dict]:
    """
    Key fundamental metrics for the analyze panel.
    PE, PB, PS, beta, 52w range, EPS, revenue growth, ROE, debt/equity, dividend yield.
    TTL: 6 hours (these are daily values).
    """
    def _fetch():
        d = _rate_limited_get("/stock/metric", {"symbol": symbol, "metric": "all"})
        if not d:
            return None
        m = d.get("metric", {})
        if not m:
            return None
        return {
            "pe_ttm":               _safe_float(m.get("peTTM")),
            "pe_annual":            _safe_float(m.get("peAnnual")),
            "pb_annual":            _safe_float(m.get("pbAnnual")),
            "ps_ttm":               _safe_float(m.get("psTTM")),
            "beta":                 _safe_float(m.get("beta")),
            "week52_high":          _safe_float(m.get("52WeekHigh")),
            "week52_low":           _safe_float(m.get("52WeekLow")),
            "week52_high_date":     m.get("52WeekHighDate", ""),
            "week52_low_date":      m.get("52WeekLowDate", ""),
            "eps_ttm":              _safe_float(m.get("epsTTM")),
            "eps_normalized":       _safe_float(m.get("epsNormalizedAnnual")),
            "revenue_growth_yoy":   _safe_float(m.get("revenueGrowthTTMYoy")),
            "roe_ttm":              _safe_float(m.get("roeTTM")),
            "roa_ttm":              _safe_float(m.get("roaTTM")),
            "current_ratio":        _safe_float(m.get("currentRatioAnnual")),
            "debt_equity":          _safe_float(m.get("debtEquityAnnual")),
            "dividend_yield":       _safe_float(m.get("dividendYieldIndicatedAnnual")),
            "market_cap":           _safe_float(m.get("marketCapitalization")),
            "avg_volume_10d":       _safe_float(m.get("10DayAverageTradingVolume")),
            "avg_volume_3mo":       _safe_float(m.get("3MonthAverageTradingVolume")),
            "source":               "finnhub",
        }
    return _cached(f"fundamentals:{symbol}", 6 * 3600, _fetch)


def get_recommendation(symbol: str) -> Optional[dict]:
    """
    Latest analyst consensus: strongBuy, buy, hold, sell, strongSell counts.
    Derives a normalized score from -1 (strong sell) to +1 (strong buy).
    TTL: 12 hours.
    """
    def _fetch():
        d = _rate_limited_get("/stock/recommendation", {"symbol": symbol})
        if not d or not isinstance(d, list) or not d:
            return None
        latest = d[0]
        strong_buy  = int(latest.get("strongBuy", 0))
        buy         = int(latest.get("buy", 0))
        hold        = int(latest.get("hold", 0))
        sell        = int(latest.get("sell", 0))
        strong_sell = int(latest.get("strongSell", 0))
        total = strong_buy + buy + hold + sell + strong_sell
        if total == 0:
            return None
        # Weighted score: strongBuy=+2, buy=+1, hold=0, sell=-1, strongSell=-2
        score = (strong_buy * 2 + buy * 1 + hold * 0 + sell * -1 + strong_sell * -2) / (total * 2)
        return {
            "period":       latest.get("period", ""),
            "strong_buy":   strong_buy,
            "buy":          buy,
            "hold":         hold,
            "sell":         sell,
            "strong_sell":  strong_sell,
            "total":        total,
            "score":        round(score, 3),  # -1 to +1
            "consensus":    _consensus_label(score),
            "source":       "finnhub",
        }
    return _cached(f"recommendation:{symbol}", 12 * 3600, _fetch)


def get_earnings_surprises(symbol: str) -> Optional[list[dict]]:
    """
    Last 4 quarters of earnings surprises.
    Beat/miss history is a strong predictor of near-term momentum.
    TTL: 24 hours.
    """
    def _fetch():
        d = _rate_limited_get("/stock/earnings", {"symbol": symbol})
        if not d or not isinstance(d, list):
            return None
        results = []
        for e in d[:4]:
            surprise_pct = _safe_float(e.get("surprisePercent"))
            results.append({
                "period":         e.get("period", ""),
                "year":           e.get("year"),
                "quarter":        e.get("quarter"),
                "estimate":       _safe_float(e.get("estimate")),
                "actual":         _safe_float(e.get("actual")),
                "surprise":       _safe_float(e.get("surprise")),
                "surprise_pct":   surprise_pct,
                "beat":           (surprise_pct or 0) > 0,
            })
        return results if results else None
    return _cached(f"earnings:{symbol}", 24 * 3600, _fetch)


def get_earnings_calendar(days_ahead: int = 14) -> Optional[list[dict]]:
    """
    Upcoming earnings dates for the next N days — used to flag catalyst risk.
    TTL: 6 hours.
    """
    def _fetch():
        from_dt = date.today().strftime("%Y-%m-%d")
        to_dt = (date.today() + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        d = _rate_limited_get("/calendar/earnings", {"from": from_dt, "to": to_dt})
        if not d:
            return None
        cal = d.get("earningsCalendar", [])
        results = []
        for e in cal:
            if e.get("symbol"):
                results.append({
                    "symbol":       e["symbol"],
                    "date":         e.get("date", ""),
                    "hour":         e.get("hour", ""),  # bmo / amc
                    "eps_estimate": _safe_float(e.get("epsEstimate")),
                    "eps_actual":   _safe_float(e.get("epsActual")),
                    "revenue_estimate": _safe_float(e.get("revenueEstimate")),
                })
        return results if results else None
    return _cached("earnings_calendar", 6 * 3600, _fetch)


def get_insider_sentiment(symbol: str) -> Optional[dict]:
    """
    Monthly Share Purchase Ratio (MSPR) — aggregate insider buying pressure.
    MSPR > 0 = net insider buying (bullish signal).
    MSPR < 0 = net insider selling (bearish signal).
    Covers last 12 months. TTL: 24 hours.
    """
    def _fetch():
        from_dt = (date.today() - timedelta(days=365)).strftime("%Y-%m-%d")
        to_dt = date.today().strftime("%Y-%m-%d")
        d = _rate_limited_get("/stock/insider-sentiment", {
            "symbol": symbol, "from": from_dt, "to": to_dt
        })
        if not d:
            return None
        data = d.get("data", [])
        if not data:
            return None
        # Latest month MSPR + trend over last 3 months
        recent = data[-3:]
        latest_mspr = _safe_float(recent[-1].get("mspr")) if recent else None
        avg_mspr_3mo = (
            sum(_safe_float(m.get("mspr"), 0) for m in recent) / len(recent)
            if recent else None
        )
        return {
            "latest_mspr":    latest_mspr,
            "avg_mspr_3mo":   round(avg_mspr_3mo, 2) if avg_mspr_3mo is not None else None,
            "signal":         _mspr_signal(latest_mspr),
            "monthly_data":   [{"year": m["year"], "month": m["month"],
                                "mspr": _safe_float(m.get("mspr")),
                                "change": m.get("change", 0)} for m in data[-6:]],
            "source":         "finnhub",
        }
    return _cached(f"insider_sentiment:{symbol}", 24 * 3600, _fetch)


def get_insider_transactions(symbol: str) -> Optional[list[dict]]:
    """
    Recent individual insider buy/sell transactions. TTL: 6 hours.
    """
    def _fetch():
        d = _rate_limited_get("/stock/insider-transactions", {"symbol": symbol})
        if not d:
            return None
        txns = d.get("data", [])
        results = []
        for t in txns[:10]:
            results.append({
                "name":       t.get("name", ""),
                "type":       t.get("transactionType", ""),
                "shares":     t.get("share", 0),
                "price":      _safe_float(t.get("transactionPrice")),
                "date":       t.get("transactionDate", ""),
                "filing_date": t.get("filingDate", ""),
            })
        return results if results else None
    return _cached(f"insider_txns:{symbol}", 6 * 3600, _fetch)


def get_company_news(symbol: str, days: int = 7) -> Optional[list[dict]]:
    """Latest news for a symbol. TTL: 30 minutes."""
    def _fetch():
        from_dt = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")
        to_dt = date.today().strftime("%Y-%m-%d")
        d = _rate_limited_get("/company-news", {
            "symbol": symbol, "from": from_dt, "to": to_dt
        })
        if not d or not isinstance(d, list):
            return None
        results = []
        for a in d[:15]:
            results.append({
                "headline":  a.get("headline", ""),
                "summary":   a.get("summary", "")[:200],
                "source":    a.get("source", ""),
                "url":       a.get("url", ""),
                "datetime":  a.get("datetime", 0),
                "image":     a.get("image", ""),
            })
        return results if results else None
    return _cached(f"news:{symbol}", 1800, _fetch)


def get_market_news(category: str = "general") -> Optional[list[dict]]:
    """Market-wide news. Categories: general, forex, crypto, merger. TTL: 15 minutes."""
    def _fetch():
        d = _rate_limited_get("/news", {"category": category})
        if not d or not isinstance(d, list):
            return None
        return [{"headline": a.get("headline", ""), "source": a.get("source", ""),
                 "url": a.get("url", ""), "datetime": a.get("datetime", 0),
                 "summary": a.get("summary", "")[:200]} for a in d[:20]]
    return _cached(f"market_news:{category}", 900, _fetch)


def get_peers(symbol: str) -> Optional[list[str]]:
    """Peer company tickers. TTL: 24 hours."""
    def _fetch():
        d = _rate_limited_get("/stock/peers", {"symbol": symbol})
        if not d or not isinstance(d, list):
            return None
        return [s for s in d if s != symbol]
    return _cached(f"peers:{symbol}", 24 * 3600, _fetch)


def get_social_sentiment(symbol: str) -> Optional[dict]:
    """Reddit/Twitter mention scores and sentiment. TTL: 1 hour."""
    def _fetch():
        from_dt = (date.today() - timedelta(days=7)).strftime("%Y-%m-%d")
        d = _rate_limited_get("/stock/social-sentiment", {"symbol": symbol, "from": from_dt})
        if not d:
            return None
        reddit = d.get("reddit", [])
        twitter = d.get("twitter", [])

        def _agg(items: list) -> Optional[dict]:
            if not items:
                return None
            total_mention = sum(i.get("mention", 0) for i in items)
            avg_score = sum(i.get("score", 0) for i in items) / len(items) if items else 0
            return {"mentions": total_mention, "avg_score": round(avg_score, 4)}

        return {
            "reddit":  _agg(reddit),
            "twitter": _agg(twitter),
            "source":  "finnhub",
        }
    return _cached(f"social:{symbol}", 3600, _fetch)


def get_economic_calendar() -> Optional[list[dict]]:
    """Upcoming macro events (CPI, FOMC, GDP, jobs). TTL: 6 hours."""
    def _fetch():
        d = _rate_limited_get("/calendar/economic", {})
        if not d:
            return None
        events = d.get("economicCalendar", [])
        results = []
        today = date.today().isoformat()
        for e in events:
            if e.get("time", "") >= today:
                results.append({
                    "event":    e.get("event", ""),
                    "time":     e.get("time", ""),
                    "country":  e.get("country", ""),
                    "impact":   e.get("impact", ""),  # high/medium/low
                    "actual":   e.get("actual"),
                    "estimate": e.get("estimate"),
                    "prev":     e.get("prev"),
                })
        return results[:30] if results else None
    return _cached("economic_calendar", 6 * 3600, _fetch)


def get_profile(symbol: str) -> Optional[dict]:
    """Company profile: sector, industry, market cap, logo. TTL: 24 hours."""
    def _fetch():
        d = _rate_limited_get("/stock/profile2", {"symbol": symbol})
        if not d or not d.get("ticker"):
            return None
        return {
            "name":        d.get("name", ""),
            "ticker":      d.get("ticker", ""),
            "exchange":    d.get("exchange", ""),
            "industry":    d.get("finnhubIndustry", ""),
            "market_cap":  _safe_float(d.get("marketCapitalization")),
            "shares_out":  _safe_float(d.get("shareOutstanding")),
            "logo":        d.get("logo", ""),
            "weburl":      d.get("weburl", ""),
            "ipo":         d.get("ipo", ""),
            "currency":    d.get("currency", "USD"),
            "country":     d.get("country", ""),
            "source":      "finnhub",
        }
    return _cached(f"profile:{symbol}", 24 * 3600, _fetch)


def get_congressional_trading(symbol: str) -> Optional[list[dict]]:
    """Congressional buy/sell disclosures — smart money signal. TTL: 24 hours."""
    def _fetch():
        d = _rate_limited_get("/stock/congressional-trading", {"symbol": symbol})
        if not d:
            return None
        data = d.get("data", [])
        results = []
        for t in data[:10]:
            results.append({
                "name":           t.get("name", ""),
                "transaction":    t.get("transaction", ""),
                "amount":         t.get("amount", ""),
                "date":           t.get("transactionDate", ""),
                "filed_date":     t.get("filedDate", ""),
            })
        return results if results else None
    return _cached(f"congress:{symbol}", 24 * 3600, _fetch)


def get_symbol_earnings_date(symbol: str) -> Optional[dict]:
    """
    Check if this symbol has an earnings date in the next 14 days.
    Returns None if no upcoming earnings found.
    """
    cal = get_earnings_calendar(days_ahead=14)
    if not cal:
        return None
    for e in cal:
        if e["symbol"].upper() == symbol.upper():
            return e
    return None


def get_full_context(symbol: str) -> dict:
    """
    Aggregate all free-tier Finnhub signals for the analyze panel.
    Non-blocking: returns whatever is cached; triggers background fetch for misses.
    """
    return {
        "fundamentals":        get_fundamentals(symbol),
        "recommendation":      get_recommendation(symbol),
        "earnings_surprises":  get_earnings_surprises(symbol),
        "insider_sentiment":   get_insider_sentiment(symbol),
        "peers":               get_peers(symbol),
        "upcoming_earnings":   get_symbol_earnings_date(symbol),
        "social":              get_social_sentiment(symbol),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_float(val, default=None) -> Optional[float]:
    if val is None:
        return default
    try:
        return round(float(val), 4)
    except (TypeError, ValueError):
        return default


def _consensus_label(score: float) -> str:
    if score >= 0.6:   return "Strong Buy"
    if score >= 0.2:   return "Buy"
    if score >= -0.2:  return "Hold"
    if score >= -0.6:  return "Sell"
    return "Strong Sell"


def _mspr_signal(mspr: Optional[float]) -> str:
    if mspr is None:     return "neutral"
    if mspr >= 30:       return "strong_buy"
    if mspr >= 10:       return "buy"
    if mspr >= -10:      return "neutral"
    if mspr >= -30:      return "sell"
    return "strong_sell"
