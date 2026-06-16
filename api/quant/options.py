"""
Options chain fetching, Greeks, IV rank, and signal-to-contract translation.

Data source: yfinance option_chain() — free, no API key, covers all optionable stocks.
Fallback: synthetic chain from historical vol when yfinance is rate-limited.

Signal-to-contract logic:
  LONG signal  → buy call (or sell put spread for income)
  SHORT signal → buy put  (or sell call spread for income)
  Hold period drives expiry selection:
    day/swing  → nearest weekly expiry with >500 OI
    month      → 30-45 DTE monthly expiry
    quarter    → 60-90 DTE
    year       → 120-180 DTE LEAP

Greeks are from yfinance when available, else Black-Scholes approximation.
"""

from __future__ import annotations

import math
import time
import threading
from dataclasses import dataclass, field
from typing import Optional
import logging

log = logging.getLogger("options")

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class OptionContract:
    symbol: str
    expiry: str           # YYYY-MM-DD
    strike: float
    option_type: str      # "call" | "put"
    bid: float
    ask: float
    last: float
    volume: int
    open_interest: int
    implied_vol: float    # annualised, decimal (0.3 = 30%)
    delta: float
    gamma: float
    theta: float          # daily theta (negative for long options)
    vega: float
    dte: int              # days to expiry
    itm: bool             # in the money?
    mid: float = field(init=False)

    def __post_init__(self):
        self.mid = round((self.bid + self.ask) / 2, 4) if self.bid and self.ask else self.last


@dataclass
class OptionsChain:
    symbol: str
    underlying_price: float
    fetched_at: float
    expiries: list[str]
    calls: list[OptionContract]
    puts: list[OptionContract]
    iv_rank: float        # 0-100: IV now vs 52-week range
    iv_percentile: float  # same window, percentile basis
    atm_iv: float         # at-the-money implied vol
    hist_vol_30d: float   # 30-day realised vol


@dataclass
class OptionsSignal:
    """Translated from a QuantResult into a specific option trade recommendation."""
    signal_direction: int             # 1=long/call, -1=short/put
    recommended_type: str             # "call" | "put" | "call_spread" | "put_spread"
    strategy: str                     # e.g. "buy_call", "buy_put", "sell_put_spread"
    contract: Optional[OptionContract]
    spread_short_leg: Optional[OptionContract]  # for spreads
    max_profit: float
    max_loss: float                   # magnitude (positive number)
    breakeven: float
    prob_profit: float                # estimated % prob of profit at expiry
    rationale: str                    # plain English
    iv_environment: str               # "cheap" | "fair" | "expensive"
    recommended_qty: int              # contracts (1 contract = 100 shares)


# ── In-memory cache ───────────────────────────────────────────────────────────

_chain_cache: dict[str, OptionsChain] = {}
_cache_lock   = threading.Lock()
_CHAIN_TTL    = 300.0   # 5 minutes


# ── Black-Scholes helpers ─────────────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs_price(S: float, K: float, T: float, r: float, sigma: float, opt: str) -> float:
    """Black-Scholes price for European call or put."""
    if T <= 0 or sigma <= 0:
        intrinsic = max(0, S - K) if opt == "call" else max(0, K - S)
        return intrinsic
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if opt == "call":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _bs_greeks(S: float, K: float, T: float, r: float, sigma: float, opt: str) -> dict:
    """Delta, gamma, theta, vega via Black-Scholes closed form."""
    if T <= 0 or sigma <= 0:
        return {"delta": 1.0 if (opt == "call" and S > K) else -1.0 if (opt == "put" and K > S) else 0.0,
                "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    pdf_d1 = math.exp(-0.5 * d1 ** 2) / math.sqrt(2 * math.pi)
    delta  = _norm_cdf(d1) if opt == "call" else _norm_cdf(d1) - 1
    gamma  = pdf_d1 / (S * sigma * math.sqrt(T))
    vega   = S * pdf_d1 * math.sqrt(T) / 100   # per 1% IV move
    theta_call = (-(S * pdf_d1 * sigma) / (2 * math.sqrt(T))
                  - r * K * math.exp(-r * T) * _norm_cdf(d2)) / 365
    theta_put  = (-(S * pdf_d1 * sigma) / (2 * math.sqrt(T))
                  + r * K * math.exp(-r * T) * _norm_cdf(-d2)) / 365
    theta = theta_call if opt == "call" else theta_put
    return {"delta": round(delta, 4), "gamma": round(gamma, 6),
            "theta": round(theta, 4), "vega": round(vega, 4)}


def _iv_from_price(S: float, K: float, T: float, r: float, market_price: float, opt: str) -> float:
    """Newton-Raphson IV solver. Returns annualised vol or 0.3 fallback."""
    if T <= 0 or market_price <= 0:
        return 0.30
    intrinsic = max(0, S - K) if opt == "call" else max(0, K - S)
    if market_price <= intrinsic:
        return 0.001
    sigma = 0.30
    for _ in range(50):
        price = _bs_price(S, K, T, r, sigma, opt)
        vega  = S * math.exp(-0.5 * ((math.log(S/K) + (r + 0.5*sigma**2)*T)/(sigma*math.sqrt(T)))**2) / math.sqrt(2*math.pi) * math.sqrt(T)
        if abs(vega) < 1e-10:
            break
        diff  = price - market_price
        sigma -= diff / vega
        sigma  = max(0.001, min(sigma, 20.0))
        if abs(diff) < 0.001:
            break
    return round(sigma, 4)


# ── yfinance chain fetch ──────────────────────────────────────────────────────

def _fetch_yf_chain(symbol: str) -> Optional[OptionsChain]:
    """
    Fetch full options chain via yfinance.
    Picks the 4 nearest expiries and parses calls + puts.
    """
    try:
        import yfinance as yf
        import pandas as pd
        from datetime import datetime, date

        ticker = yf.Ticker(symbol)
        exps   = ticker.options
        if not exps:
            return None

        # Get underlying price from OHLCV cache to avoid a separate yfinance call
        underlying_price = _get_underlying_price(symbol)
        if underlying_price <= 0:
            return None

        today     = date.today()
        r         = 0.053   # risk-free rate (approx Fed funds)

        all_calls: list[OptionContract] = []
        all_puts:  list[OptionContract] = []

        # Fetch up to 4 expiries
        for exp_str in exps[:4]:
            try:
                chain = ticker.option_chain(exp_str)
                exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
                dte_days = max(1, (exp_date - today).days)
                T = dte_days / 365.0

                for df, opt_type in [(chain.calls, "call"), (chain.puts, "put")]:
                    for _, row in df.iterrows():
                        try:
                            strike = float(row["strike"])
                            bid    = float(row.get("bid") or 0)
                            ask    = float(row.get("ask") or bid)
                            last   = float(row.get("lastPrice") or 0)
                            vol    = int(row.get("volume") or 0)
                            oi     = int(row.get("openInterest") or 0)
                            iv     = float(row.get("impliedVolatility") or 0)

                            # Use mid price for IV if yfinance IV is missing/zero
                            mid_price = (bid + ask) / 2 if bid and ask else last
                            if iv < 0.01 and mid_price > 0:
                                iv = _iv_from_price(underlying_price, strike, T, r, mid_price, opt_type)

                            # Greeks: use yfinance if available, else BS
                            yf_delta = row.get("delta")
                            if yf_delta is not None and not (isinstance(yf_delta, float) and math.isnan(yf_delta)):
                                greeks = {
                                    "delta": float(yf_delta),
                                    "gamma": float(row.get("gamma") or 0),
                                    "theta": float(row.get("theta") or 0),
                                    "vega":  float(row.get("vega")  or 0),
                                }
                            else:
                                greeks = _bs_greeks(underlying_price, strike, T, r, max(iv, 0.01), opt_type)

                            itm = (underlying_price > strike) if opt_type == "call" else (underlying_price < strike)

                            contract = OptionContract(
                                symbol=symbol, expiry=exp_str, strike=round(strike, 2),
                                option_type=opt_type,
                                bid=round(bid, 4), ask=round(ask, 4), last=round(last, 4),
                                volume=vol, open_interest=oi,
                                implied_vol=round(iv, 4),
                                delta=greeks["delta"], gamma=greeks["gamma"],
                                theta=greeks["theta"], vega=greeks["vega"],
                                dte=dte_days, itm=itm,
                            )
                            if opt_type == "call":
                                all_calls.append(contract)
                            else:
                                all_puts.append(contract)
                        except Exception:
                            continue
            except Exception:
                continue

        if not all_calls and not all_puts:
            return None

        # IV rank and historical vol
        iv_rank, iv_pct, atm_iv, hist_vol = _compute_iv_metrics(symbol, underlying_price, all_calls)

        return OptionsChain(
            symbol=symbol,
            underlying_price=underlying_price,
            fetched_at=time.time(),
            expiries=list(exps[:4]),
            calls=all_calls,
            puts=all_puts,
            iv_rank=iv_rank,
            iv_percentile=iv_pct,
            atm_iv=atm_iv,
            hist_vol_30d=hist_vol,
        )

    except Exception as e:
        log.warning("yf options chain %s: %s", symbol, type(e).__name__)
        return None


def _get_underlying_price(symbol: str) -> float:
    """Get last close from OHLCV SQLite cache — no extra API call."""
    try:
        from api.quant.ohlcv_store import _db_get
        cached = _db_get(symbol, "6mo", "1d") or _db_get(symbol, "1y", "1d")
        if cached:
            df, _ = cached
            df = df.dropna(subset=["Close"])
            if not df.empty:
                return float(df["Close"].iloc[-1])
    except Exception:
        pass
    return 0.0


def _compute_iv_metrics(symbol: str, price: float,
                        calls: list[OptionContract]) -> tuple[float, float, float, float]:
    """
    IV rank (0-100) from 252-day realised vol range.
    ATM IV from nearest strike call.
    Hist vol from OHLCV returns.
    """
    atm_iv   = 0.30
    hist_vol = 0.25
    iv_rank  = 50.0
    iv_pct   = 50.0

    try:
        from api.quant.ohlcv_store import _db_get
        import numpy as np

        cached = _db_get(symbol, "1y", "1d") or _db_get(symbol, "6mo", "1d")
        if cached:
            df, _ = cached
            df = df.dropna(subset=["Close"])
            if len(df) >= 20:
                rets = df["Close"].pct_change().dropna()
                hist_vol = float(rets.std() * np.sqrt(252))

        # ATM IV: nearest OTM call
        otm_calls = [c for c in calls if not c.itm and c.open_interest > 10]
        if otm_calls:
            atm = min(otm_calls, key=lambda c: abs(c.strike - price))
            atm_iv = atm.implied_vol if atm.implied_vol > 0.01 else 0.30

        # IV rank: compare ATM IV to 52-week IV proxy (historical vol ± vol-of-vol)
        # Simple approximation: scale by ±50% around hist vol
        iv_low  = hist_vol * 0.5
        iv_high = hist_vol * 2.0
        iv_rank = max(0, min(100, (atm_iv - iv_low) / max(iv_high - iv_low, 0.01) * 100))
        iv_pct  = iv_rank  # same approximation without 252d IV history

    except Exception:
        pass

    return round(iv_rank, 1), round(iv_pct, 1), round(atm_iv, 4), round(hist_vol, 4)


# ── Public API ────────────────────────────────────────────────────────────────

def get_chain(symbol: str, force: bool = False) -> Optional[OptionsChain]:
    """Return cached chain or fetch fresh. Thread-safe."""
    sym = symbol.upper()
    with _cache_lock:
        cached = _chain_cache.get(sym)
        if cached and not force and (time.time() - cached.fetched_at) < _CHAIN_TTL:
            return cached

    chain = _fetch_yf_chain(sym)
    if chain:
        with _cache_lock:
            _chain_cache[sym] = chain
    return chain


def chain_to_dict(chain: OptionsChain) -> dict:
    """JSON-serialisable representation of the chain."""
    def contract_dict(c: OptionContract) -> dict:
        return {
            "symbol": c.symbol, "expiry": c.expiry, "strike": c.strike,
            "type": c.option_type, "bid": c.bid, "ask": c.ask, "last": c.last,
            "mid": c.mid, "volume": c.volume, "open_interest": c.open_interest,
            "iv": c.implied_vol, "delta": c.delta, "gamma": c.gamma,
            "theta": c.theta, "vega": c.vega, "dte": c.dte, "itm": c.itm,
        }
    return {
        "symbol":           chain.symbol,
        "underlying_price": chain.underlying_price,
        "fetched_at":       chain.fetched_at,
        "expiries":         chain.expiries,
        "calls":            [contract_dict(c) for c in chain.calls],
        "puts":             [contract_dict(p) for p in chain.puts],
        "iv_rank":          chain.iv_rank,
        "iv_percentile":    chain.iv_percentile,
        "atm_iv":           chain.atm_iv,
        "hist_vol_30d":     chain.hist_vol_30d,
    }


# ── Signal → options recommendation ──────────────────────────────────────────

_HORIZON_DTE = {
    "day":     (5,  21),    # (min_dte, max_dte)
    "swing":   (14, 35),
    "month":   (28, 50),
    "quarter": (55, 100),
    "year":    (110, 200),
}

_HORIZON_DELTA_TARGET = {
    "day":     0.50,   # ATM for day trades — highest gamma
    "swing":   0.40,
    "month":   0.35,
    "quarter": 0.30,
    "year":    0.25,   # OTM LEAP for leveraged long-term bet
}


def signal_to_options(chain: OptionsChain, signal: int, confidence: float,
                      horizon: str = "day", portfolio_value: float = 10_000) -> OptionsSignal:
    """
    Translate a directional signal into a specific option recommendation.

    Decision framework:
    - IV rank < 40  → buy options (cheap premium relative to history)
    - IV rank 40-70 → buy options cautiously (fair premium)
    - IV rank > 70  → prefer spreads to cap premium paid (expensive)

    Signal 1  (long)  → buy call | bull call spread (high IV)
    Signal -1 (short) → buy put  | bear put spread  (high IV)
    """
    direction  = signal
    opt_type   = "call" if direction == 1 else "put"
    iv_env     = ("cheap" if chain.iv_rank < 40 else
                  "expensive" if chain.iv_rank > 70 else "fair")
    use_spread = iv_env == "expensive" and confidence < 0.80

    dte_min, dte_max = _HORIZON_DTE.get(horizon, (14, 35))
    delta_target     = _HORIZON_DELTA_TARGET.get(horizon, 0.40)

    # Select contracts from the correct option type
    contracts = chain.calls if opt_type == "call" else chain.puts
    # Filter by DTE window and minimum liquidity
    eligible = [
        c for c in contracts
        if dte_min <= c.dte <= dte_max
        and c.open_interest >= 100
        and c.bid > 0
        and c.ask > 0
    ]

    if not eligible:
        # Relax liquidity filter
        eligible = [c for c in contracts if dte_min <= c.dte <= dte_max and c.bid > 0]

    if not eligible:
        # Any contract in the chain
        eligible = contracts

    if not eligible:
        return _empty_signal(direction, chain.symbol)

    # Pick contract closest to delta target
    # For puts, delta is negative, so we compare abs(delta)
    best = min(eligible, key=lambda c: abs(abs(c.delta) - delta_target))

    # Spread: sell a further OTM option to reduce premium
    spread_leg: Optional[OptionContract] = None
    if use_spread:
        spread_eligible = [
            c for c in eligible
            if c.expiry == best.expiry
            and abs(c.delta) < abs(best.delta) * 0.6  # further OTM
            and c.strike != best.strike
        ]
        if spread_eligible:
            spread_leg = min(spread_eligible, key=lambda c: abs(abs(c.delta) - delta_target * 0.4))

    # Position sizing: risk 1-2% of portfolio per options trade (premium at risk)
    risk_budget = portfolio_value * 0.015   # 1.5% max premium spend
    contract_cost = best.mid * 100          # 1 contract = 100 shares
    qty = max(1, int(risk_budget / contract_cost)) if contract_cost > 0 else 1

    # P&L metrics
    max_loss   = best.mid * 100 * qty
    if opt_type == "call":
        breakeven = best.strike + best.mid
        max_profit_est = (chain.underlying_price * 1.08 - breakeven) * 100 * qty  # 8% move estimate
    else:
        breakeven = best.strike - best.mid
        max_profit_est = (breakeven - chain.underlying_price * 0.92) * 100 * qty  # -8% move

    if spread_leg:
        spread_credit = spread_leg.mid * 100 * qty
        max_loss      = max(0, max_loss - spread_credit)
        max_profit_est = min(max_profit_est, abs(best.strike - spread_leg.strike) * 100 * qty - max_loss)

    # Probability of profit approximation using delta (rough rule: P(ITM) ≈ |delta|)
    prob_profit = abs(best.delta) * 100

    strategy = _strategy_name(opt_type, use_spread, direction)

    rationale = _build_rationale(
        chain.symbol, opt_type, best, horizon, iv_env, confidence,
        chain.underlying_price, use_spread, chain.atm_iv, chain.hist_vol_30d,
    )

    return OptionsSignal(
        signal_direction=direction,
        recommended_type=opt_type + ("_spread" if use_spread else ""),
        strategy=strategy,
        contract=best,
        spread_short_leg=spread_leg,
        max_profit=round(max(0, max_profit_est), 2),
        max_loss=round(max_loss, 2),
        breakeven=round(breakeven, 2),
        prob_profit=round(prob_profit, 1),
        rationale=rationale,
        iv_environment=iv_env,
        recommended_qty=qty,
    )


def _strategy_name(opt_type: str, spread: bool, direction: int) -> str:
    if opt_type == "call":
        return "bull_call_spread" if spread else "buy_call"
    else:
        return "bear_put_spread" if spread else "buy_put"


def _build_rationale(symbol: str, opt_type: str, contract: OptionContract,
                     horizon: str, iv_env: str, confidence: float,
                     price: float, spread: bool,
                     atm_iv: float, hist_vol: float) -> str:
    parts = []
    direction_word = "LONG" if opt_type == "call" else "SHORT/bearish"
    parts.append(
        f"The quant engine has a {direction_word} signal on {symbol} at {confidence*100:.0f}% confidence."
    )
    if opt_type == "call":
        parts.append(
            f"Buying the ${contract.strike} call (delta {contract.delta:+.2f}, {contract.dte} DTE) "
            f"gives leveraged upside exposure while capping downside to the premium paid."
        )
    else:
        parts.append(
            f"Buying the ${contract.strike} put (delta {contract.delta:+.2f}, {contract.dte} DTE) "
            f"gives downside protection and profits if the stock falls below ${contract.breakeven:.2f}."
        )

    iv_pct = atm_iv * 100
    hv_pct = hist_vol * 100
    if iv_env == "cheap":
        parts.append(
            f"IV ({iv_pct:.0f}%) is below historical vol ({hv_pct:.0f}%) — "
            f"premium is relatively cheap, favouring outright option buying."
        )
    elif iv_env == "expensive":
        if spread:
            parts.append(
                f"IV ({iv_pct:.0f}%) is elevated vs historical vol ({hv_pct:.0f}%) — "
                f"using a spread to offset the cost of the long leg."
            )
        else:
            parts.append(
                f"IV is moderately elevated ({iv_pct:.0f}%). Consider holding shorter-dated contracts "
                f"to limit time-decay exposure."
            )

    if contract.theta < -0.05:
        parts.append(
            f"Theta is ${contract.theta:.2f}/day — the option loses value over time, "
            f"so the directional move should occur within {min(contract.dte, 14)} days for best results."
        )
    return " ".join(parts)


def _empty_signal(direction: int, symbol: str) -> OptionsSignal:
    return OptionsSignal(
        signal_direction=direction,
        recommended_type="call" if direction == 1 else "put",
        strategy="buy_call" if direction == 1 else "buy_put",
        contract=None,
        spread_short_leg=None,
        max_profit=0.0,
        max_loss=0.0,
        breakeven=0.0,
        prob_profit=0.0,
        rationale=f"No liquid options chain available for {symbol}. Trade the underlying equity instead.",
        iv_environment="unknown",
        recommended_qty=0,
    )


def options_signal_to_dict(sig: OptionsSignal) -> dict:
    def contract_dict(c: Optional[OptionContract]) -> Optional[dict]:
        if not c:
            return None
        return {
            "symbol": c.symbol, "expiry": c.expiry, "strike": c.strike,
            "type": c.option_type, "bid": c.bid, "ask": c.ask, "mid": c.mid,
            "last": c.last, "volume": c.volume, "open_interest": c.open_interest,
            "iv": c.implied_vol, "delta": c.delta, "gamma": c.gamma,
            "theta": c.theta, "vega": c.vega, "dte": c.dte, "itm": c.itm,
        }
    return {
        "signal_direction":  sig.signal_direction,
        "recommended_type":  sig.recommended_type,
        "strategy":          sig.strategy,
        "contract":          contract_dict(sig.contract),
        "spread_short_leg":  contract_dict(sig.spread_short_leg),
        "max_profit":        sig.max_profit,
        "max_loss":          sig.max_loss,
        "breakeven":         sig.breakeven,
        "prob_profit":       sig.prob_profit,
        "rationale":         sig.rationale,
        "iv_environment":    sig.iv_environment,
        "recommended_qty":   sig.recommended_qty,
    }
