"""
intraday_engine.py — Algorithmic signal generation on 1-minute OHLCV bars.

No ML, no LLM. Four statistically-grounded signals:
  1. Opening Range Breakout (ORB) — first-15-min high/low with volume confirmation
  2. VWAP Reclaim — cumulative VWAP crossover with volume surge
     (time-gated: no VWAP signals before 10:30 AM ET — too few bars for stable VWAP)
  3. ATR Impulse — single-bar momentum (bar range > 0.6x ATR with above-avg volume)
  4. RSI Gate — RSI(9) on 1-min bars; blocks entries at extremes

Composite fires when ≥ 2 of the 4 signals agree on direction.

Usage:
    from api.quant.intraday_engine import IntradayEngine, IntradaySignal
    engine = IntradayEngine()
    signal = engine.evaluate(df_1min, user_direction=1)  # 1=LONG, -1=SHORT
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import time as _time_t
from typing import Optional

import numpy as np
import pandas as pd

try:
    from zoneinfo import ZoneInfo as _ZI
    _ET = _ZI("America/New_York")
except ImportError:
    import datetime as _dt_mod
    from datetime import timezone
    _ET = timezone(_dt_mod.timedelta(hours=-4))

log = logging.getLogger("intraday_engine")

# ── Config constants ───────────────────────────────────────────────────────────
ORB_BARS          = 15    # first N 1-min bars form the opening range
ORB_VOL_MULT      = 1.5   # volume must be ≥ this × avg_volume to confirm ORB break
VWAP_VOL_MULT     = 1.3   # volume surge required for VWAP reclaim signal
ATR_IMPULSE_MULT  = 0.6   # bar range must be ≥ this × ATR(14) to count as impulse
ATR_VOL_MULT      = 1.2   # volume must be ≥ this × recent avg to confirm impulse
RSI_PERIOD        = 9
RSI_OVERBOUGHT    = 75    # block new longs above this
RSI_OVERSOLD      = 25    # block new shorts below this
STOP_ATR_MULT     = 1.5   # stop distance = ATR × this multiplier
TARGET_RR         = 2.5   # risk:reward ratio for take-profit

# ── Regime filter thresholds (Advisor 2) ──────────────────────────────────────
# Compare today's first-hour range to the 5-day average daily ATR baseline.
#   first_hour_range / avg_daily_atr ≥ REGIME_VOLATILE_THRESH → volatile/mean-reverting:
#       ORB signals are less reliable (gap-and-fade risk); require 3-of-3 instead of 2-of-3.
#   first_hour_range / avg_daily_atr ≤ REGIME_TREND_THRESH    → quiet/trending day:
#       ORB and VWAP signals are more reliable; normal 2-of-3 threshold.
#   Between thresholds → mixed: normal 2-of-3 threshold.
REGIME_VOLATILE_THRESH = 1.5   # first-hour range > 1.5× avg daily ATR → volatile day
REGIME_TREND_THRESH    = 0.5   # first-hour range < 0.5× avg daily ATR → trending day


@dataclass
class IntradaySignal:
    direction: int          # 1=LONG, -1=SHORT, 0=NO_SIGNAL
    entry_price: float
    stop_price: float
    target_price: float
    confidence: float       # 0.0–1.0 (fraction of signals agreeing)
    signals_fired: list[str] = field(default_factory=list)
    reason: str = ""

    @property
    def risk_pct(self) -> float:
        if self.entry_price <= 0:
            return 0.0
        return abs(self.entry_price - self.stop_price) / self.entry_price * 100

    @property
    def reward_pct(self) -> float:
        if self.entry_price <= 0:
            return 0.0
        return abs(self.target_price - self.entry_price) / self.entry_price * 100


def _rsi(close: pd.Series, period: int = 9) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
    loss  = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
    rs    = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, prev_close = df["High"], df["Low"], df["Close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(com=period - 1, adjust=False).mean()


def _cumulative_vwap(df: pd.DataFrame) -> pd.Series:
    """Standard cumulative VWAP from the first bar of the session."""
    typical = (df["High"] + df["Low"] + df["Close"]) / 3
    cum_tpv = (typical * df["Volume"]).cumsum()
    cum_vol = df["Volume"].cumsum().replace(0, np.nan)
    return cum_tpv / cum_vol


def _classify_regime(df: pd.DataFrame) -> tuple[str, float]:
    """
    Classify today's intraday character: "volatile", "trending", or "mixed".

    Method (Advisor 2):
      1. Compute avg_daily_atr = mean of daily True Range over last 5 bars of available
         intraday data (proxy for the 5-day ATR baseline using intraday data only).
      2. Compute first_hour_range = High - Low of the first 60 bars (first hour).
      3. ratio = first_hour_range / avg_daily_atr
         ≥ 1.5 → volatile/mean-reverting day (require stricter signal threshold)
         ≤ 0.5 → quiet/trending day (normal threshold, ORB/VWAP more reliable)
         else  → mixed

    Returns (regime_label, ratio). ratio=0.0 if insufficient data.
    """
    if df is None or len(df) < ORB_BARS + 1:
        return "mixed", 0.0

    # First-hour range (up to 60 bars)
    first_60 = df.iloc[:60]
    first_hour_range = float(first_60["High"].max() - first_60["Low"].min())

    # Proxy for 5-day average daily ATR: use the rolling ATR on the full intraday series
    # and take the mean of the last 5 values (each 1-min ATR value reflects recent vol).
    atr_s = _atr(df, period=14)
    valid  = atr_s.dropna()
    if len(valid) < 5:
        return "mixed", 0.0
    avg_atr = float(valid.iloc[-5:].mean())
    if avg_atr <= 0:
        return "mixed", 0.0

    ratio = first_hour_range / avg_atr
    if ratio >= REGIME_VOLATILE_THRESH:
        return "volatile", round(ratio, 2)
    if ratio <= REGIME_TREND_THRESH:
        return "trending", round(ratio, 2)
    return "mixed", round(ratio, 2)


class IntradayEngine:
    """
    Evaluates the current 1-minute bar DataFrame against four signals.
    Call evaluate() on every new bar to get the current IntradaySignal.
    """

    def evaluate(
        self,
        df: pd.DataFrame,
        user_direction: int = 0,   # 1=user thinks LONG, -1=SHORT, 0=no bias (algorithm decides)
    ) -> IntradaySignal:
        """
        Evaluate signals on the latest bar of `df`.

        Args:
            df: 1-minute OHLCV DataFrame, oldest bar first, columns Open/High/Low/Close/Volume.
            user_direction: If non-zero, only signals matching this direction count toward
                            the composite. This implements the "execution discipline" model
                            where the user provides directional conviction and the algorithm
                            provides timing.

        Returns IntradaySignal with direction=0 if no composite fires.
        """
        if df is None or len(df) < ORB_BARS + 5:
            return IntradaySignal(0, 0.0, 0.0, 0.0, 0.0, reason="insufficient bars")

        df = df.copy()
        current_price = float(df["Close"].iloc[-1])
        current_vol   = float(df["Volume"].iloc[-1])

        # ── Regime classification (Advisor 2) ────────────────────────────────
        # On a volatile/mean-reverting day, ORB breakouts are trap-prone.
        # Require all 3 non-gate signals to agree instead of just 2.
        regime, regime_ratio = _classify_regime(df)
        composite_threshold = 3 if regime == "volatile" else 2

        # ── Derived series ──
        avg_vol_20  = df["Volume"].rolling(20).mean().iloc[-1] or 1.0
        avg_vol_15  = df["Volume"].iloc[:ORB_BARS].mean() or 1.0
        atr_series  = _atr(df, period=14)
        atr_val     = float(atr_series.iloc[-1]) if not np.isnan(atr_series.iloc[-1]) else 0.0
        rsi_series  = _rsi(df["Close"], period=RSI_PERIOD)
        rsi_val     = float(rsi_series.iloc[-1]) if not np.isnan(rsi_series.iloc[-1]) else 50.0
        vwap_series = _cumulative_vwap(df)
        vwap_val    = float(vwap_series.iloc[-1]) if not np.isnan(vwap_series.iloc[-1]) else current_price

        # Opening range (first ORB_BARS bars)
        orb_high = float(df["High"].iloc[:ORB_BARS].max())
        orb_low  = float(df["Low"].iloc[:ORB_BARS].min())

        signals_long:  list[str] = []
        signals_short: list[str] = []

        # ── Signal 1: Opening Range Breakout ──────────────────────────────────
        if len(df) > ORB_BARS:
            vol_ok = current_vol >= avg_vol_15 * ORB_VOL_MULT
            if current_price > orb_high and vol_ok:
                signals_long.append("ORB_break_up")
            elif current_price < orb_low and vol_ok:
                signals_short.append("ORB_break_down")

        # ── Signal 2: VWAP Reclaim ────────────────────────────────────────────
        # VWAP needs ≥ 60 minutes of data to be statistically stable — gate before 10:30 AM.
        # Also requires at least 3 bars so iloc[-2] is safe.
        from datetime import datetime as _dt_cls
        _now_et_time = _dt_cls.now(_ET).time()
        _vwap_ready = _now_et_time >= _time_t(10, 30) and len(df) >= 3
        if _vwap_ready:
            prev_close  = float(df["Close"].iloc[-2])
            prev_vwap_v = vwap_series.iloc[-2]
            prev_vwap   = float(prev_vwap_v) if not np.isnan(prev_vwap_v) else vwap_val
            vol_surge   = current_vol >= avg_vol_20 * VWAP_VOL_MULT
            # Price crossed VWAP from below (long) or from above (short)
            if prev_close < prev_vwap and current_price > vwap_val and vol_surge:
                signals_long.append("VWAP_reclaim_up")
            elif prev_close > prev_vwap and current_price < vwap_val and vol_surge:
                signals_short.append("VWAP_reclaim_down")

        # ── Signal 3: ATR Impulse ─────────────────────────────────────────────
        if atr_val > 0:
            last_bar   = df.iloc[-1]
            bar_range  = float(last_bar["High"] - last_bar["Low"])
            bar_close  = float(last_bar["Close"])
            bar_open   = float(last_bar["Open"])
            vol_ok     = current_vol >= avg_vol_20 * ATR_VOL_MULT
            impulse_ok = bar_range >= atr_val * ATR_IMPULSE_MULT
            if impulse_ok and vol_ok:
                if bar_close > bar_open:   # bullish impulse bar
                    signals_long.append("ATR_impulse_up")
                else:                       # bearish impulse bar
                    signals_short.append("ATR_impulse_down")

        # ── Signal 4: RSI Gate (blocks, doesn't add) ──────────────────────────
        rsi_blocks_long  = rsi_val > RSI_OVERBOUGHT
        rsi_blocks_short = rsi_val < RSI_OVERSOLD
        if rsi_blocks_long:
            signals_long = []   # wipe: model is overheated for longs
        if rsi_blocks_short:
            signals_short = []  # wipe: model is oversold — no new shorts

        # ── Apply user directional filter ─────────────────────────────────────
        if user_direction == 1:
            signals_short = []   # user is long-biased: ignore short triggers
        elif user_direction == -1:
            signals_long = []    # user is short-biased: ignore long triggers

        # ── Composite: need ≥ composite_threshold agreeing signals ───────────
        # Normal (mixed/trending) day: ≥2. Volatile/mean-reverting day: ≥3.
        all_fired: list[str] = []
        composite_dir = 0

        if len(signals_long) >= composite_threshold:
            composite_dir = 1
            all_fired = signals_long
        elif len(signals_short) >= composite_threshold:
            composite_dir = -1
            all_fired = signals_short

        if composite_dir == 0 or atr_val <= 0:
            rsi_note   = f" (RSI {rsi_val:.0f}" + (" — overbought" if rsi_blocks_long else " — oversold" if rsi_blocks_short else "") + ")"
            vwap_gate  = " [VWAP gated until 10:30 AM]" if not _vwap_ready else ""
            regime_note = f" [regime={regime} ratio={regime_ratio:.2f} → need {composite_threshold}/3 signals]" if regime == "volatile" else ""
            reason = (f"No composite signal. Long triggers: {signals_long or 'none'}. "
                      f"Short triggers: {signals_short or 'none'}.{rsi_note}{vwap_gate}{regime_note}")
            return IntradaySignal(0, current_price, 0.0, 0.0, 0.0, reason=reason)

        # ── Price levels ──────────────────────────────────────────────────────
        stop_dist   = atr_val * STOP_ATR_MULT
        target_dist = stop_dist * TARGET_RR

        if composite_dir == 1:
            stop_price   = current_price - stop_dist
            target_price = current_price + target_dist
        else:
            stop_price   = current_price + stop_dist
            target_price = current_price - target_dist

        # Confidence = fraction of possible non-gate signals that fired (max 3)
        confidence = min(len(all_fired) / 3.0, 1.0)

        vwap_note   = f"VWAP={vwap_val:.2f}"
        orb_note    = f"ORB={orb_low:.2f}-{orb_high:.2f}"
        rsi_note    = f"RSI={rsi_val:.0f}"
        regime_note = f" regime={regime}" if regime != "mixed" else ""
        dir_word    = "LONG" if composite_dir == 1 else "SHORT"
        reason = (
            f"{dir_word} signal: {', '.join(all_fired)}. "
            f"Entry={current_price:.2f} Stop={stop_price:.2f} Target={target_price:.2f}. "
            f"{vwap_note} {orb_note} {rsi_note} ATR={atr_val:.3f}{regime_note}"
        )

        return IntradaySignal(
            direction    = composite_dir,
            entry_price  = round(current_price, 4),
            stop_price   = round(stop_price, 4),
            target_price = round(target_price, 4),
            confidence   = round(confidence, 3),
            signals_fired= all_fired,
            reason       = reason,
        )

    def get_context(self, df: pd.DataFrame) -> dict:
        """
        Return current intraday context metrics for display in the UI.
        Safe to call even with few bars.
        """
        if df is None or df.empty:
            return {}
        try:
            current_price = float(df["Close"].iloc[-1])
            vwap = float(_cumulative_vwap(df).iloc[-1])
            atr  = float(_atr(df).iloc[-1])
            rsi  = float(_rsi(df["Close"]).iloc[-1])
            orb_high = float(df["High"].iloc[:ORB_BARS].max()) if len(df) >= ORB_BARS else 0.0
            orb_low  = float(df["Low"].iloc[:ORB_BARS].min()) if len(df) >= ORB_BARS else 0.0
            above_vwap = current_price > vwap
            regime, regime_ratio = _classify_regime(df)
            return {
                "price":        round(current_price, 4),
                "vwap":         round(vwap, 4),
                "above_vwap":   above_vwap,
                "atr":          round(atr, 4),
                "rsi":          round(rsi, 1),
                "orb_high":     round(orb_high, 4),
                "orb_low":      round(orb_low, 4),
                "bar_count":    len(df),
                "regime":       regime,
                "regime_ratio": regime_ratio,
            }
        except Exception as e:
            log.debug("get_context error: %s", e)
            return {}
