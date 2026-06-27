"""
Quant Trading Engine
Implements strategies from QuantBasics: ADV normalization, multi-factor signals,
volume curve prediction, Kelly criterion sizing, Monte Carlo risk, ensemble models.

Horizon support:
  day    — intraday/overnight, 1-2 day hold. ATR%, volume surge, 6mo lookback.
  swing  — 1–4 week hold. EMA crossovers, RSI reversion, earnings proximity.
  month  — 1–3 month. Medium-term trend + sector relative strength.
  quarter— 3–6 month. Price momentum + macro regime.
  year   — 6–12 month. Jegadeesh-Titman 12-1mo momentum, Hurst mean-reversion.
"""

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from dataclasses import dataclass, field
from typing import Optional
import warnings
warnings.filterwarnings('ignore')

# Valid horizon keys and their metadata
HORIZONS = {
    "day":     {"label": "Day Trade",    "period": "6mo",  "hold_days": 1,   "mc_horizon": 5},
    "swing":   {"label": "Swing (1-4w)", "period": "6mo",  "hold_days": 10,  "mc_horizon": 14},
    "month":   {"label": "1 Month",      "period": "6mo",  "hold_days": 21,  "mc_horizon": 21},
    "quarter": {"label": "3 Months",     "period": "1y",   "hold_days": 63,  "mc_horizon": 63},
    "year":    {"label": "6-12 Months",  "period": "1y",   "hold_days": 252, "mc_horizon": 126},
}
DEFAULT_HORIZON = "day"


# ─── Data Structures ─────────────────────────────────────────────────────────

@dataclass
class Signal:
    direction: int          # 1=long, -1=short, 0=flat
    confidence: float       # 0.0–1.0
    source: str             # which sub-model generated this
    entry_price: float
    stop_loss: float
    take_profit: float
    position_fraction: float  # Kelly-sized fraction of portfolio


@dataclass
class QuantResult:
    symbol: str
    signals: list[Signal]
    composite_signal: int
    composite_confidence: float
    regime: str             # trending / mean-reverting / volatile / quiet
    risk_metrics: dict
    indicators: dict
    position_size_pct: float
    expected_return: float
    sharpe_estimate: float
    max_drawdown_estimate: float
    monte_carlo: dict
    horizon: str = "day"    # which horizon this result is scored for
    horizon_score: float = 0.0  # horizon-specific composite score (for ranking)
    beginner_summary: str = ""  # one plain-English sentence for beginner mode
    oos_sharpe: float = 0.0     # out-of-sample Sharpe from hold-out fold
    feature_importance: list = field(default_factory=list)  # top-3 [(feature, importance), …]


# ─── Feature Engineering (QuantBasics §5: normalisation, §10: feature selection)

class FeatureEngineer:
    """Builds ADV-normalised, re-centred features as described in QuantBasics §5."""

    def __init__(self, adv_window: int = 20):
        self.adv_window = adv_window
        self.scaler = StandardScaler()

    def compute(self, df: pd.DataFrame) -> pd.DataFrame:
        close = df["Close"].astype(float)
        volume = df["Volume"].astype(float)
        high = df["High"].astype(float)
        low = df["Low"].astype(float)

        f = pd.DataFrame(index=df.index)

        # ── Price normalisation (§5.2 relative price movements) ──
        f["ret_1d"]  = close.pct_change(1)
        f["ret_5d"]  = close.pct_change(5)
        f["ret_20d"] = close.pct_change(20)

        # Normalise by rolling volatility — "rate of a rate of change"
        vol_20 = close.pct_change().rolling(20).std()
        f["ret_1d_norm"]  = f["ret_1d"]  / (vol_20 + 1e-8)
        f["ret_5d_norm"]  = f["ret_5d"]  / (vol_20 + 1e-8)

        # ── Volume normalisation (§5.1 ADV) ──
        adv = volume.rolling(self.adv_window).mean()
        f["vol_adv_ratio"] = volume / (adv + 1)

        # ── Momentum ──
        f["mom_12_1"] = close.shift(21) / close.shift(1) - 1   # Jegadeesh-Titman
        f["mom_3"]    = close / close.shift(3) - 1

        # ── Trend indicators ──
        ema_8  = close.ewm(span=8,  adjust=False).mean()
        ema_21 = close.ewm(span=21, adjust=False).mean()
        ema_55 = close.ewm(span=55, adjust=False).mean()
        f["ema_8_21_spread"]  = (ema_8  - ema_21) / (close + 1e-8)
        f["ema_21_55_spread"] = (ema_21 - ema_55) / (close + 1e-8)
        f["price_ema55_spread"] = (close - ema_55) / (close + 1e-8)

        # ── RSI (Wilder, EWM version as in simulator) ──
        delta = close.diff()
        gains  = delta.clip(lower=0)
        losses = -delta.clip(upper=0)
        avg_g  = gains.ewm(span=14, adjust=False).mean()
        avg_l  = losses.ewm(span=14, adjust=False).mean()
        rs     = avg_g / (avg_l + 1e-8)
        f["rsi_14"] = 100 - 100 / (1 + rs)
        f["rsi_norm"] = (f["rsi_14"] - 50) / 25    # centred, §5.4

        # ── Bollinger Bands ──
        bb_mid  = close.rolling(20).mean()
        bb_std  = close.rolling(20).std()
        f["bb_pct"] = (close - bb_mid) / (2 * bb_std + 1e-8)  # -1 to +1

        # ── MACD ──
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd  = ema12 - ema26
        macd_signal = macd.ewm(span=9, adjust=False).mean()
        f["macd_hist_norm"] = (macd - macd_signal) / (close + 1e-8)

        # ── ATR-normalised volatility ──
        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low  - close.shift(1)).abs()
        ], axis=1).max(axis=1)
        atr_14 = tr.ewm(span=14, adjust=False).mean()
        f["atr_pct"] = atr_14 / (close + 1e-8)

        # ── Market microstructure: bid-ask proxy ──
        hl_range = (high - low) / (close + 1e-8)
        f["hl_range_adv"] = hl_range / (hl_range.rolling(20).mean() + 1e-8)

        # ── Volume curve (§10 volume curve prediction idea) ──
        intraday_vol_curve = volume / (volume.rolling(5).sum() + 1)
        f["vol_curve"] = intraday_vol_curve

        # ── Regime features ──
        f["hurst"] = self._rolling_hurst(close, window=40)
        f["autocorr_1"] = close.pct_change().rolling(20).apply(
            lambda x: pd.Series(x).autocorr(lag=1), raw=False
        )

        # Target: next-day return sign for supervised learning
        f["target"] = np.sign(close.shift(-1) / close - 1).fillna(0)

        return f.dropna()

    @staticmethod
    def _rolling_hurst(series: pd.Series, window: int = 40) -> pd.Series:
        """Hurst exponent via R/S analysis. H>0.5 = trending, H<0.5 = mean-reverting."""
        def hurst(ts):
            if len(ts) < 10:
                return 0.5
            try:
                ts = np.array(ts)
                mean_ts = np.mean(ts)
                deviation = np.cumsum(ts - mean_ts)
                R = np.max(deviation) - np.min(deviation)
                S = np.std(ts, ddof=1) + 1e-8
                return np.log(R / S) / np.log(len(ts) / 2)
            except Exception:
                return 0.5
        return series.pct_change().rolling(window).apply(hurst, raw=True).fillna(0.5)


# ─── Regime Detection (QuantBasics §9.3 clustering + §7 hypothesis testing)

class RegimeDetector:
    """Classifies market into 4 regimes using rolling statistics."""

    TRENDING_UP   = "trending_up"
    TRENDING_DOWN = "trending_down"
    MEAN_REVERTING = "mean_reverting"
    VOLATILE      = "volatile"
    QUIET         = "quiet"

    def detect(self, features: pd.DataFrame) -> str:
        if features.empty:
            return self.QUIET

        row = features.iloc[-1]
        hurst     = float(row.get("hurst", 0.5))
        atr_pct   = float(row.get("atr_pct", 0.01))
        ema_spread = float(row.get("ema_8_21_spread", 0))
        rsi        = float(row.get("rsi_14", 50))

        atr_hist = features["atr_pct"].tail(60)
        atr_pct_rank = stats.percentileofscore(atr_hist, atr_pct) / 100

        if atr_pct_rank > 0.85:
            return self.VOLATILE
        if hurst > 0.6:
            return self.TRENDING_UP if ema_spread > 0 else self.TRENDING_DOWN
        if hurst < 0.4:
            return self.MEAN_REVERTING
        return self.QUIET


# ─── Signal Generators (ensemble, QuantBasics §10.5 decision trees, §10.6 neural)

class MeanReversionSignal:
    """Bollinger Band + RSI mean reversion. Best in mean-reverting regime."""

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if len(features) < 2:
            return None
        row = features.iloc[-1]
        bb_pct = float(row.get("bb_pct", 0))
        rsi    = float(row.get("rsi_14", 50))

        if bb_pct < -0.85 and rsi < 35:
            conf = min(0.9, abs(bb_pct) * 0.5 + (35 - rsi) / 70)
            return Signal(1, conf, "mean_reversion",
                          price, price * 0.985, price * 1.025, 0.0)
        if bb_pct > 0.85 and rsi > 65:
            conf = min(0.9, abs(bb_pct) * 0.5 + (rsi - 65) / 70)
            return Signal(-1, conf, "mean_reversion",
                          price, price * 1.015, price * 0.975, 0.0)
        return None


class TrendFollowSignal:
    """Triple EMA + MACD. Best in trending regime."""

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if len(features) < 2:
            return None
        row  = features.iloc[-1]
        prev = features.iloc[-2]
        ema_spread  = float(row.get("ema_8_21_spread", 0))
        ema_spread_p = float(prev.get("ema_8_21_spread", 0))
        macd_h      = float(row.get("macd_hist_norm", 0))
        mom          = float(row.get("mom_3", 0))

        # Golden cross-like: spread turning positive
        if ema_spread > 0 > ema_spread_p and macd_h > 0 and mom > 0:
            conf = min(0.9, abs(ema_spread) * 20 + macd_h * 50)
            return Signal(1, conf, "trend_follow",
                          price, price * 0.982, price * 1.04, 0.0)
        if ema_spread < 0 < ema_spread_p and macd_h < 0 and mom < 0:
            conf = min(0.9, abs(ema_spread) * 20 + abs(macd_h) * 50)
            return Signal(-1, conf, "trend_follow",
                          price, price * 1.018, price * 0.96, 0.0)
        return None


class MomentumSignal:
    """12-1 month momentum (Jegadeesh-Titman). Works in trending regimes."""

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if len(features) < 2:
            return None
        row = features.iloc[-1]
        mom_12_1 = float(row.get("mom_12_1", 0))
        vol_adv  = float(row.get("vol_adv_ratio", 1))

        # Volume confirmation (QuantBasics §5.1 ADV)
        vol_conf = vol_adv > 1.2

        if mom_12_1 > 0.05 and vol_conf:
            conf = min(0.85, mom_12_1 * 3)
            return Signal(1, conf, "momentum",
                          price, price * 0.975, price * 1.06, 0.0)
        if mom_12_1 < -0.05 and vol_conf:
            conf = min(0.85, abs(mom_12_1) * 3)
            return Signal(-1, conf, "momentum",
                          price, price * 1.025, price * 0.94, 0.0)
        return None


class IntradayMomentumSignal:
    """
    Day-trade focused: volume surge + short-term price spike + ATR expansion.
    Uses last 5 bars to detect today's breakout/breakdown vs prior range.
    """

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if len(features) < 6:
            return None
        row  = features.iloc[-1]
        vol_adv   = float(row.get("vol_adv_ratio", 1))
        ret_1d    = float(row.get("ret_1d", 0))
        atr_pct   = float(row.get("atr_pct", 0.01))
        rsi       = float(row.get("rsi_14", 50))
        ema_sp    = float(row.get("ema_8_21_spread", 0))

        # Volume surge + gap-up momentum (breakout)
        if vol_adv > 1.8 and ret_1d > atr_pct * 0.6 and ema_sp > 0 and rsi < 75:
            conf = min(0.88, (vol_adv - 1) * 0.15 + ret_1d / (atr_pct + 1e-8) * 0.08)
            return Signal(1, conf, "intraday_momentum",
                          price, price * (1 - atr_pct * 1.2), price * (1 + atr_pct * 2), 0.0)
        # Volume surge + gap-down oversold bounce
        if vol_adv > 2.0 and ret_1d < -atr_pct * 0.8 and rsi < 32:
            conf = min(0.82, (vol_adv - 1.5) * 0.12 + abs(ret_1d) / (atr_pct + 1e-8) * 0.06)
            return Signal(1, conf, "intraday_momentum",
                          price, price * (1 - atr_pct * 0.8), price * (1 + atr_pct * 1.5), 0.0)
        return None


class LongTermMomentumSignal:
    """
    6-12 month horizon: cross-sectional Jegadeesh-Titman 12-1 momentum + Hurst.
    Only fires when trend persistence (Hurst>0.55) supports multi-month continuation.
    """

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if len(features) < 30:
            return None
        row = features.iloc[-1]
        mom_12_1  = float(row.get("mom_12_1", 0))
        hurst     = float(row.get("hurst", 0.5))
        ema_sp    = float(row.get("ema_21_55_spread", 0))
        rsi       = float(row.get("rsi_14", 50))

        # Strong 12-1mo momentum with trend persistence — continuation play
        if mom_12_1 > 0.15 and hurst > 0.55 and ema_sp > 0 and rsi < 78:
            conf = min(0.88, mom_12_1 * 1.8 + (hurst - 0.5) * 0.8)
            return Signal(1, conf, "longterm_momentum",
                          price, price * 0.92, price * 1.18, 0.0)
        # Crashed hard, now mean-reverting — contrarian long
        if mom_12_1 < -0.20 and hurst < 0.42 and rsi < 35:
            conf = min(0.75, abs(mom_12_1) * 1.2 + (0.5 - hurst) * 0.6)
            return Signal(1, conf, "longterm_momentum",
                          price, price * 0.88, price * 1.22, 0.0)
        return None


class MLSignal:
    """
    Gradient Boosted Trees (QuantBasics §10.5 decision trees, §10.6).
    Trained on walk-forward windows to avoid look-ahead bias (§7.1).
    """

    def __init__(self):
        self.model = GradientBoostingClassifier(
            n_estimators=80, max_depth=3, learning_rate=0.08,
            subsample=1.0, random_state=42
        )
        self.scaler = StandardScaler()
        self.trained = False
        self.feature_cols = [
            "ret_1d_norm", "ret_5d_norm", "vol_adv_ratio",
            "mom_12_1", "mom_3", "ema_8_21_spread", "ema_21_55_spread",
            "rsi_norm", "bb_pct", "macd_hist_norm", "atr_pct",
            "hl_range_adv", "hurst", "autocorr_1"
        ]
        self._min_train = 60
        self.oos_sharpe: float = 0.0
        self.top_features: list = []  # [(name, importance), …] top-3

    def fit(self, features: pd.DataFrame):
        available = [c for c in self.feature_cols if c in features.columns]
        X = features[available].values
        y = features["target"].values

        if len(X) < self._min_train or len(np.unique(y)) < 2:
            return

        # Walk-forward split: last 20% is the hold-out (OOS) fold
        tscv = TimeSeriesSplit(n_splits=3, test_size=max(10, len(X) // 5))
        best_split = list(tscv.split(X))[-1]
        train_idx, test_idx = best_split

        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        X_scaled = self.scaler.fit_transform(X_train)
        self.model.fit(X_scaled, y_train)
        self.trained = True
        self._available_cols = available

        # OOS Sharpe: treat each correct-direction prediction as +1, wrong as -1
        if len(X_test) >= 5:
            X_test_sc = self.scaler.transform(X_test)
            preds = self.model.predict(X_test_sc)
            oos_returns = np.where(preds == y_test, 0.01, -0.01)  # synthetic ±1% per bar
            std = oos_returns.std()
            self.oos_sharpe = float(oos_returns.mean() / std * np.sqrt(252)) if std > 0 else 0.0

        # Top-3 feature importances
        imp = self.model.feature_importances_
        pairs = sorted(zip(available, imp.tolist()), key=lambda x: -x[1])
        self.top_features = [(name, round(float(v), 4)) for name, v in pairs[:3]]

    def generate(self, features: pd.DataFrame, price: float) -> Optional[Signal]:
        if not self.trained or len(features) < 2:
            return None
        try:
            available = [c for c in self._available_cols if c in features.columns]
            x = features[available].iloc[[-1]].values
            x_scaled = self.scaler.transform(x)
            proba = self.model.predict_proba(x_scaled)[0]
            classes = self.model.classes_

            long_p  = proba[list(classes).index(1.0)]  if 1.0  in classes else 0.0
            short_p = proba[list(classes).index(-1.0)] if -1.0 in classes else 0.0

            if long_p > 0.62:
                return Signal(1, long_p, "ml_gbm",
                              price, price * 0.98, price * 1.035, 0.0)
            if short_p > 0.62:
                return Signal(-1, short_p, "ml_gbm",
                              price, price * 1.02, price * 0.965, 0.0)
        except Exception:
            pass
        return None


# ─── Position Sizing: Kelly Criterion (QuantBasics §3 performance metrics)

class KellySizer:
    """
    Fractional Kelly sizing.  f* = (bp - q) / b
    where b = avg win / avg loss, p = win rate, q = 1-p.
    Caps at 25% and applies 0.5x fractional factor for safety.
    """

    @staticmethod
    def size(win_rate: float, avg_win: float, avg_loss: float,
             max_fraction: float = 0.25) -> float:
        if avg_loss == 0:
            return 0.0
        b = avg_win / (avg_loss + 1e-8)
        q = 1 - win_rate
        kelly = (b * win_rate - q) / (b + 1e-8)
        half_kelly = kelly * 0.5   # Half-Kelly for robustness
        return float(np.clip(half_kelly, 0.0, max_fraction))

    @staticmethod
    def estimate_from_history(returns: np.ndarray) -> float:
        if len(returns) < 10:
            return 0.05
        wins  = returns[returns > 0]
        losses = returns[returns < 0]
        if len(wins) == 0 or len(losses) == 0:
            return 0.02
        win_rate = len(wins) / len(returns)
        avg_win  = float(np.mean(wins))
        avg_loss = float(np.abs(np.mean(losses)))
        return KellySizer.size(win_rate, avg_win, avg_loss)


# ─── Monte Carlo Risk (QuantBasics §7.2)

class MonteCarloRisk:
    """
    Simulates N paths of a portfolio to estimate:
    - 5th/50th/95th percentile PnL
    - Max drawdown distribution
    - VaR / CVaR
    Uses empirical return distribution (no Gaussian assumption — §4.4 warning).
    """

    def __init__(self, n_simulations: int = 1000, horizon: int = 21):
        self.n_sims = n_simulations
        self.horizon = horizon

    def run(self, historical_returns: np.ndarray,
            position_fraction: float = 0.1) -> dict:
        if len(historical_returns) < 20:
            return self._empty_result()

        # Bootstrap from empirical distribution (avoids Gaussian assumption)
        rng = np.random.default_rng(42)
        sampled = rng.choice(historical_returns, size=(self.n_sims, self.horizon), replace=True)

        # Scale by position fraction
        portfolio_paths = np.cumprod(1 + sampled * position_fraction, axis=1)

        final_values = portfolio_paths[:, -1]
        drawdowns    = self._max_drawdown_vec(portfolio_paths)

        var_5pct = float(np.percentile(final_values, 5))
        cvar     = float(np.mean(final_values[final_values <= var_5pct]))

        return {
            "p5":  float(np.percentile(final_values, 5)),
            "p50": float(np.percentile(final_values, 50)),
            "p95": float(np.percentile(final_values, 95)),
            "var_5pct":      round((var_5pct - 1) * 100, 2),
            "cvar_5pct":     round((cvar - 1) * 100, 2),
            "median_dd":     round(float(np.median(drawdowns)) * 100, 2),
            "worst_dd":      round(float(np.percentile(drawdowns, 95)) * 100, 2),
            "prob_positive": round(float(np.mean(final_values > 1)) * 100, 1),
        }

    @staticmethod
    def _max_drawdown_vec(paths: np.ndarray) -> np.ndarray:
        cum_max = np.maximum.accumulate(paths, axis=1)
        dd      = (cum_max - paths) / (cum_max + 1e-8)
        return dd.max(axis=1)

    def _empty_result(self) -> dict:
        return {k: 0.0 for k in [
            "p5", "p50", "p95", "var_5pct", "cvar_5pct",
            "median_dd", "worst_dd", "prob_positive"
        ]}


# ─── Performance Metrics (QuantBasics §3)

class PerformanceMetrics:
    """Slippage-vs-arrival, Sharpe, Sortino, Calmar — all notional-weighted."""

    @staticmethod
    def sharpe(returns: np.ndarray, ann_factor: float = 252) -> float:
        if len(returns) < 5 or returns.std() == 0:
            return 0.0
        return float(np.mean(returns) / np.std(returns, ddof=1) * np.sqrt(ann_factor))

    @staticmethod
    def sortino(returns: np.ndarray, ann_factor: float = 252) -> float:
        down = returns[returns < 0]
        if len(down) == 0 or down.std() == 0:
            return float(np.mean(returns) * ann_factor * 10)
        return float(np.mean(returns) / np.std(down, ddof=1) * np.sqrt(ann_factor))

    @staticmethod
    def max_drawdown(equity_curve: np.ndarray) -> float:
        cum_max = np.maximum.accumulate(equity_curve)
        dd = (cum_max - equity_curve) / (cum_max + 1e-8)
        return float(dd.max())

    @staticmethod
    def slippage_vs_arrival(trades: list[dict]) -> float:
        """
        Notional-weighted average slippage (QuantBasics §3.1.3).
        Returns bps.
        """
        if not trades:
            return 0.0
        total_nv = sum(t.get("notional", 0) for t in trades)
        if total_nv == 0:
            return 0.0
        weighted_slip = sum(
            t.get("slippage_bps", 0) * t.get("notional", 0) for t in trades
        )
        return weighted_slip / total_nv


# ─── Beginner summary builder

def _build_beginner_summary(
    symbol: str, signal: int, confidence: float, regime: str,
    indicators: dict, risk: dict, mc: dict, kelly_f: float, horizon: str,
) -> str:
    conf_pct = int(round(confidence * 100))
    rsi = indicators.get("rsi_14", 50)
    mom = indicators.get("mom_12_1", 0)
    mc_prob = mc.get("prob_positive", 50) if mc else 50
    kelly_pct = round(kelly_f * 100, 1)

    horizon_labels = {
        "day": "today", "swing": "over the next 1–4 weeks",
        "month": "over the next month", "quarter": "over the next 3 months",
        "year": "over the next 6–12 months",
    }
    when = horizon_labels.get(horizon, "over the holding period")

    r = regime.lower()
    if "trending_up" in r:
        regime_note = "It's in a clear uptrend"
    elif "trending_down" in r:
        regime_note = "It's in a downtrend — caution for buyers"
    elif "volatile" in r:
        regime_note = "It's been volatile lately"
    elif "mean_rev" in r:
        regime_note = "It's bouncing between highs and lows"
    else:
        regime_note = "The market is quiet right now"

    if signal == 1:
        if mom > 10:
            trend_note = f"strong recent momentum (+{mom:.0f}% over the past year)"
        elif rsi < 40:
            trend_note = f"an oversold RSI of {rsi:.0f} suggesting a potential bounce"
        else:
            trend_note = f"multiple bullish signals aligning"
        return (
            f"{symbol} shows a BUY signal with {conf_pct}% confidence {when} — "
            f"{regime_note} and the model sees {trend_note}. "
            f"Monte Carlo simulations give a {mc_prob:.0f}% chance of profit. "
            f"Suggested position: {kelly_pct:.1f}% of your account."
        )
    elif signal == -1:
        if rsi > 65:
            trend_note = f"an overbought RSI of {rsi:.0f} suggesting a potential pullback"
        elif mom < -10:
            trend_note = f"significant downward momentum ({mom:.0f}% over the past year)"
        else:
            trend_note = "multiple bearish signals aligning"
        return (
            f"{symbol} shows a SELL/SHORT signal with {conf_pct}% confidence {when} — "
            f"{regime_note} and the model sees {trend_note}. "
            f"If you hold {symbol}, consider reducing your position."
        )
    else:
        return (
            f"{symbol} shows no clear signal right now — {regime_note}. "
            f"The model's sub-signals are mixed and confidence is below threshold. "
            f"Best to wait for a clearer setup before trading."
        )


# ─── Master Quant Engine

class QuantEngine:
    """
    Orchestrates all sub-models into a single composite signal with:
    - Regime-aware weighting (trending → trend signals; mean-reverting → MR signals)
    - Per-symbol ML model cache — correct isolation + 10x speedup on repeat calls
    - Kelly sizing
    - Monte Carlo risk gate
    """

    # Class-level ML cache: (symbol, horizon, data_hash) → {"model": MLSignal, "ts": float}
    # 24-hour TTL; data_hash detects fresh data even within the TTL window.
    _ML_CACHE:     dict = {}
    _ML_CACHE_TTL: float = 24 * 3600  # seconds
    _ML_LOCK = __import__("threading").Lock()

    def __init__(self):
        self.feature_eng     = FeatureEngineer()
        self.regime_det      = RegimeDetector()
        self.mr_signal       = MeanReversionSignal()
        self.trend_signal    = TrendFollowSignal()
        self.mom_signal      = MomentumSignal()
        self.intraday_signal = IntradayMomentumSignal()
        self.lt_mom_signal   = LongTermMomentumSignal()
        self.kelly           = KellySizer()
        self.mc_risk         = MonteCarloRisk(n_simulations=500, horizon=21)
        self.metrics         = PerformanceMetrics()

    def _get_ml_signal(self, features: pd.DataFrame, symbol: str,
                       horizon: str = DEFAULT_HORIZON) -> MLSignal:
        """Return a trained MLSignal, keyed by (symbol, horizon, data_hash) with 24h TTL."""
        import time as _t, hashlib as _hl
        now = _t.time()
        # Cheap hash: last-close price fingerprint of the trailing 30 bars
        tail = features["ret_1d_norm"].iloc[-30:] if "ret_1d_norm" in features.columns else features.iloc[-30:, 0]
        data_hash = _hl.md5(tail.values.tobytes()).hexdigest()[:12]
        cache_key = (symbol, horizon, data_hash)
        with self._ML_LOCK:
            entry = self._ML_CACHE.get(cache_key)
            if entry is not None and (now - entry["ts"]) < self._ML_CACHE_TTL:
                return entry["model"]
        ml = MLSignal()
        ml.fit(features.iloc[:-1])
        with self._ML_LOCK:
            self._ML_CACHE[cache_key] = {"model": ml, "ts": now}
        return ml

    def analyze(self, df: pd.DataFrame, symbol: str = "UNKNOWN",
                horizon: str = DEFAULT_HORIZON) -> QuantResult:
        if df.empty or len(df) < 50:
            return self._empty_result(symbol, horizon)

        # 1. Feature engineering
        features = self.feature_eng.compute(df)
        if features.empty:
            return self._empty_result(symbol, horizon)

        price = float(df["Close"].iloc[-1])
        returns = df["Close"].pct_change().dropna().values

        # 2. Get per-symbol ML model (cached; trains on first call, reuses thereafter)
        ml_signal = self._get_ml_signal(features, symbol, horizon)

        # 3. Regime detection
        regime = self.regime_det.detect(features)

        # 4. Signal generation — horizon-specific signal set
        signals: list[Signal] = []
        generators = self._signal_generators_for_horizon(horizon, ml_signal)
        for gen in generators:
            sig = gen.generate(features, price)
            if sig:
                signals.append(sig)

        # 5. Regime-aware + horizon-aware ensemble weighting
        weights = self._regime_weights(regime, horizon)
        composite, confidence = self._ensemble(signals, weights)

        # 6. Kelly sizing — tighter for short horizons, standard for longer
        kelly_f = self.kelly.estimate_from_history(returns)
        if horizon == "day":
            kelly_f = min(kelly_f, 0.15)   # cap day-trade at 15%
        elif horizon == "swing":
            kelly_f = min(kelly_f, 0.20)

        # 7. Monte Carlo risk gate — horizon-tuned simulation window
        mc_horizon = HORIZONS.get(horizon, HORIZONS[DEFAULT_HORIZON])["mc_horizon"]
        mc_runner = MonteCarloRisk(n_simulations=500, horizon=mc_horizon)
        mc = mc_runner.run(returns, position_fraction=kelly_f)
        cvar_threshold = -5.0 if horizon == "day" else -8.0
        if mc["cvar_5pct"] < cvar_threshold:
            kelly_f *= 0.5

        # 8. Risk metrics
        risk = {
            "sharpe":       round(self.metrics.sharpe(returns), 3),
            "sortino":      round(self.metrics.sortino(returns), 3),
            "max_drawdown": round(self.metrics.max_drawdown(
                np.cumprod(1 + returns)), 4),
            "volatility_ann": round(float(returns.std()) * np.sqrt(252) * 100, 2),
            "win_rate":     round(float(np.mean(returns > 0)) * 100, 1),
        }

        # 9. Indicator snapshot
        last = features.iloc[-1]
        indicators = {
            "rsi_14":           round(float(last.get("rsi_14", 50)), 2),
            "macd_hist_norm":   round(float(last.get("macd_hist_norm", 0)), 6),
            "bb_pct":           round(float(last.get("bb_pct", 0)), 4),
            "ema_8_21_spread":  round(float(last.get("ema_8_21_spread", 0)), 6),
            "ema_21_55_spread": round(float(last.get("ema_21_55_spread", 0)), 6),
            "atr_pct":          round(float(last.get("atr_pct", 0.01)) * 100, 3),
            "vol_adv_ratio":    round(float(last.get("vol_adv_ratio", 1)), 3),
            "hurst":            round(float(last.get("hurst", 0.5)), 3),
            "mom_12_1":         round(float(last.get("mom_12_1", 0)) * 100, 2),
            "mom_3":            round(float(last.get("mom_3", 0)) * 100, 2),
            "ret_5d":           round(float(last.get("ret_5d", 0)) * 100, 2),
        }

        # Expected return — scaled to horizon hold period, not annualised
        hold_days = HORIZONS.get(horizon, HORIZONS[DEFAULT_HORIZON])["hold_days"]
        daily_mean = float(np.mean(returns))
        exp_ret = daily_mean * hold_days * confidence * max(composite, 0)

        # Horizon score for ranking — emphasises different factors per horizon
        horizon_score = self._horizon_score(features, indicators, risk, confidence,
                                            exp_ret, mc, horizon)

        # Plain-English beginner summary
        beginner_summary = _build_beginner_summary(
            symbol, composite, confidence, regime, indicators, risk, mc, kelly_f, horizon
        )

        return QuantResult(
            symbol=symbol,
            signals=signals,
            composite_signal=composite,
            composite_confidence=round(confidence, 4),
            regime=regime,
            risk_metrics=risk,
            indicators=indicators,
            position_size_pct=round(kelly_f * 100, 2),
            expected_return=round(exp_ret * 100, 4),
            sharpe_estimate=risk["sharpe"],
            max_drawdown_estimate=risk["max_drawdown"],
            monte_carlo=mc,
            horizon=horizon,
            horizon_score=round(horizon_score, 6),
            beginner_summary=beginner_summary,
            oos_sharpe=round(ml_signal.oos_sharpe, 3),
            feature_importance=ml_signal.top_features,
        )

    def _signal_generators_for_horizon(self, horizon: str, ml_signal: "MLSignal") -> list:
        """Returns the appropriate signal generator mix for each horizon."""
        if horizon == "day":
            return [self.mr_signal, self.intraday_signal, self.trend_signal, ml_signal]
        elif horizon == "swing":
            return [self.mr_signal, self.trend_signal, self.mom_signal, ml_signal]
        elif horizon == "month":
            return [self.trend_signal, self.mom_signal, self.mr_signal, ml_signal]
        elif horizon == "quarter":
            return [self.trend_signal, self.mom_signal, self.lt_mom_signal, ml_signal]
        else:  # year
            return [self.lt_mom_signal, self.trend_signal, self.mom_signal, ml_signal]

    def _horizon_score(self, features: pd.DataFrame, indicators: dict,
                       risk: dict, confidence: float, exp_ret: float,
                       mc: dict, horizon: str) -> float:
        """
        Composite ranking score tailored to each horizon.
        Higher = better candidate for that time frame.
        """
        sharpe    = risk.get("sharpe", 0)
        mc_prob   = mc.get("prob_positive", 50) / 100
        vol_adv   = indicators.get("vol_adv_ratio", 1)
        atr_pct   = indicators.get("atr_pct", 1) / 100  # convert back to fraction
        hurst     = indicators.get("hurst", 0.5)
        mom_12_1  = indicators.get("mom_12_1", 0) / 100
        rsi       = indicators.get("rsi_14", 50)
        ret_5d    = indicators.get("ret_5d", 0) / 100

        if horizon == "day":
            # Reward: volume surge, ATR (range = opportunity), tight conf × exp_ret
            vol_bonus = max(0, vol_adv - 1) * 0.15
            atr_bonus = min(atr_pct * 4, 0.20)   # more ATR = more intraday range
            return confidence * max(exp_ret, 0) + vol_bonus + atr_bonus

        elif horizon == "swing":
            # RSI reversal from oversold + MACD crossover + short momentum
            rsi_bonus  = max(0, (40 - rsi) / 40) * 0.12 if rsi < 40 else 0
            ret5_bonus = max(0, ret_5d) * 0.5
            return confidence * max(exp_ret, 0) + rsi_bonus + ret5_bonus + max(sharpe, 0) * 0.05

        elif horizon == "month":
            # Trend quality: sharpe + momentum + MC prob
            return confidence * max(exp_ret, 0) + max(sharpe, 0) * 0.08 + mc_prob * 0.06

        elif horizon == "quarter":
            # Momentum strength dominates
            mom_bonus = max(0, mom_12_1) * 0.4
            return confidence * max(exp_ret, 0) + mom_bonus + max(sharpe, 0) * 0.06

        else:  # year
            # Hurst persistence + 12-1mo momentum is the primary edge
            hurst_bonus = max(0, hurst - 0.5) * 0.5
            mom_bonus   = max(0, mom_12_1) * 0.6
            return confidence * max(exp_ret, 0) + hurst_bonus + mom_bonus

    def _regime_weights(self, regime: str, horizon: str = DEFAULT_HORIZON) -> dict:
        """Regime-conditional + horizon-conditional signal weights."""
        base = {
            "mean_reversion":    1.0,
            "trend_follow":      1.0,
            "momentum":          1.0,
            "ml_gbm":            1.5,
            "intraday_momentum": 1.0,
            "longterm_momentum": 1.0,
        }
        # Regime adjustments
        if regime in (RegimeDetector.TRENDING_UP, RegimeDetector.TRENDING_DOWN):
            base["trend_follow"]      = 2.0
            base["momentum"]          = 1.5
            base["mean_reversion"]    = 0.4
            base["intraday_momentum"] = 1.2
        elif regime == RegimeDetector.MEAN_REVERTING:
            base["mean_reversion"]    = 2.5
            base["trend_follow"]      = 0.3
            base["momentum"]          = 0.5
            base["intraday_momentum"] = 0.6
        elif regime == RegimeDetector.VOLATILE:
            base = {k: 0.3 for k in base}
            base["ml_gbm"] = 1.0
            base["intraday_momentum"] = 0.8  # volatile = intraday opportunity

        # Horizon overrides — boost the signals most predictive for this hold period
        if horizon == "day":
            base["intraday_momentum"] = max(base["intraday_momentum"], 2.0)
            base["longterm_momentum"] = 0.0  # irrelevant for day trades
        elif horizon == "swing":
            base["mean_reversion"]    = max(base["mean_reversion"], 1.8)
            base["longterm_momentum"] = 0.2
        elif horizon in ("quarter", "year"):
            base["longterm_momentum"] = max(base["longterm_momentum"], 2.0)
            base["intraday_momentum"] = 0.0  # irrelevant for multi-month holds
            base["momentum"]          = max(base["momentum"], 1.6)

        return base

    @staticmethod
    def _ensemble(signals: list[Signal], weights: dict) -> tuple[int, float]:
        if not signals:
            return 0, 0.0
        vote_long  = sum(w * s.confidence for s in signals
                         if s.direction == 1
                         for w in [weights.get(s.source, 1.0)])
        vote_short = sum(w * s.confidence for s in signals
                         if s.direction == -1
                         for w in [weights.get(s.source, 1.0)])
        total = vote_long + vote_short + 1e-8
        if vote_long > vote_short and vote_long / total > 0.55:
            return 1, vote_long / total
        if vote_short > vote_long and vote_short / total > 0.55:
            return -1, vote_short / total
        return 0, max(vote_long, vote_short) / total

    @staticmethod
    def _empty_result(symbol: str, horizon: str = DEFAULT_HORIZON) -> QuantResult:
        return QuantResult(
            symbol=symbol, signals=[], composite_signal=0,
            composite_confidence=0.0, regime="quiet",
            risk_metrics={}, indicators={},
            position_size_pct=0.0, expected_return=0.0,
            sharpe_estimate=0.0, max_drawdown_estimate=0.0,
            monte_carlo={}, horizon=horizon, horizon_score=0.0,
        )
