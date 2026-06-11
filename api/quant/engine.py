"""
Quant Trading Engine
Implements strategies from QuantBasics: ADV normalization, multi-factor signals,
volume curve prediction, Kelly criterion sizing, Monte Carlo risk, ensemble models.
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


class MLSignal:
    """
    Gradient Boosted Trees (QuantBasics §10.5 decision trees, §10.6).
    Trained on walk-forward windows to avoid look-ahead bias (§7.1).
    """

    def __init__(self):
        self.model = GradientBoostingClassifier(
            n_estimators=150, max_depth=4, learning_rate=0.05,
            subsample=0.8, random_state=42
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

    def fit(self, features: pd.DataFrame):
        available = [c for c in self.feature_cols if c in features.columns]
        X = features[available].values
        y = features["target"].values

        if len(X) < self._min_train or len(np.unique(y)) < 2:
            return

        # Walk-forward cross-validation (QuantBasics §7 hypothesis testing)
        tscv = TimeSeriesSplit(n_splits=3, test_size=max(10, len(X) // 5))
        best_split = list(tscv.split(X))[-1]
        train_idx, _ = best_split

        X_train = X[train_idx]
        y_train = y[train_idx]

        X_scaled = self.scaler.fit_transform(X_train)
        self.model.fit(X_scaled, y_train)
        self.trained = True
        self._available_cols = available

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


# ─── Master Quant Engine

class QuantEngine:
    """
    Orchestrates all sub-models into a single composite signal with:
    - Regime-aware weighting (trending → trend signals; mean-reverting → MR signals)
    - ML ensemble overlay
    - Kelly sizing
    - Monte Carlo risk gate
    """

    def __init__(self):
        self.feature_eng   = FeatureEngineer()
        self.regime_det    = RegimeDetector()
        self.mr_signal     = MeanReversionSignal()
        self.trend_signal  = TrendFollowSignal()
        self.mom_signal    = MomentumSignal()
        self.ml_signal     = MLSignal()
        self.kelly         = KellySizer()
        self.mc_risk       = MonteCarloRisk(n_simulations=500, horizon=21)
        self.metrics       = PerformanceMetrics()

    def analyze(self, df: pd.DataFrame, symbol: str = "UNKNOWN") -> QuantResult:
        if df.empty or len(df) < 30:
            return self._empty_result(symbol)

        # 1. Feature engineering
        features = self.feature_eng.compute(df)
        if features.empty:
            return self._empty_result(symbol)

        # 2. Fit ML model (walk-forward, no look-ahead)
        self.ml_signal.fit(features.iloc[:-1])  # never use last row for training

        price = float(df["Close"].iloc[-1])
        returns = df["Close"].pct_change().dropna().values

        # 3. Regime detection
        regime = self.regime_det.detect(features)

        # 4. Signal generation
        signals: list[Signal] = []
        for gen in [self.mr_signal, self.trend_signal, self.mom_signal, self.ml_signal]:
            sig = gen.generate(features, price)
            if sig:
                signals.append(sig)

        # 5. Regime-aware ensemble weighting
        weights = self._regime_weights(regime)
        composite, confidence = self._ensemble(signals, weights)

        # 6. Kelly sizing
        kelly_f = self.kelly.estimate_from_history(returns)

        # 7. Monte Carlo risk gate — only allocate if MC looks acceptable
        mc = self.mc_risk.run(returns, position_fraction=kelly_f)
        if mc["cvar_5pct"] < -8.0:
            kelly_f *= 0.5   # halve sizing in dangerous regimes

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
            "rsi_14":         round(float(last.get("rsi_14", 50)), 2),
            "macd_hist_norm": round(float(last.get("macd_hist_norm", 0)), 6),
            "bb_pct":         round(float(last.get("bb_pct", 0)), 4),
            "ema_8_21_spread": round(float(last.get("ema_8_21_spread", 0)), 6),
            "atr_pct":        round(float(last.get("atr_pct", 0.01)) * 100, 3),
            "vol_adv_ratio":  round(float(last.get("vol_adv_ratio", 1)), 3),
            "hurst":          round(float(last.get("hurst", 0.5)), 3),
            "mom_12_1":       round(float(last.get("mom_12_1", 0)) * 100, 2),
        }

        # Expected return estimate (arithmetic mean × confidence scaling)
        exp_ret = float(np.mean(returns)) * 252 * confidence * composite

        return QuantResult(
            symbol=symbol,
            signals=signals,
            composite_signal=composite,
            composite_confidence=round(confidence, 4),
            regime=regime,
            risk_metrics=risk,
            indicators=indicators,
            position_size_pct=round(kelly_f * 100, 2),
            expected_return=round(exp_ret * 100, 2),
            sharpe_estimate=risk["sharpe"],
            max_drawdown_estimate=risk["max_drawdown"],
            monte_carlo=mc,
        )

    def _regime_weights(self, regime: str) -> dict:
        """Regime-conditional signal weights."""
        base = {"mean_reversion": 1.0, "trend_follow": 1.0,
                "momentum": 1.0, "ml_gbm": 1.5}
        if regime in (RegimeDetector.TRENDING_UP, RegimeDetector.TRENDING_DOWN):
            base["trend_follow"] = 2.0
            base["momentum"]     = 1.5
            base["mean_reversion"] = 0.4
        elif regime == RegimeDetector.MEAN_REVERTING:
            base["mean_reversion"] = 2.5
            base["trend_follow"]   = 0.3
            base["momentum"]       = 0.5
        elif regime == RegimeDetector.VOLATILE:
            # Scale everything down; let ML decide
            base = {k: 0.3 for k in base}
            base["ml_gbm"] = 1.0
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
    def _empty_result(symbol: str) -> QuantResult:
        return QuantResult(
            symbol=symbol, signals=[], composite_signal=0,
            composite_confidence=0.0, regime="quiet",
            risk_metrics={}, indicators={},
            position_size_pct=0.0, expected_return=0.0,
            sharpe_estimate=0.0, max_drawdown_estimate=0.0,
            monte_carlo={}
        )
