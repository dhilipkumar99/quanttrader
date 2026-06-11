"""
Paper Trading Simulator
Runs the quant engine's signals against real historical data with virtual cash.
Tracks P&L, slippage, fills, and computes performance metrics (QuantBasics §3).
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

from .engine import QuantEngine, PerformanceMetrics


@dataclass
class Fill:
    timestamp: str
    symbol: str
    side: str          # "buy" | "sell"
    qty: int
    price: float
    commission: float
    slippage_bps: float
    notional: float


@dataclass
class PortfolioSnapshot:
    timestamp: str
    cash: float
    equity: float
    total: float
    pnl: float
    pnl_pct: float
    drawdown: float


class PaperTrader:
    """
    Simulates execution of quant signals on historical data.
    Models realistic slippage using ADV ratio (QuantBasics §5.1).
    Commission: $0.005/share (Interactive Brokers-style).
    """

    COMMISSION_PER_SHARE = 0.005
    MIN_COMMISSION       = 1.0

    def __init__(self, initial_cash: float = 100_000.0):
        self.initial_cash   = initial_cash
        self.cash           = initial_cash
        self.positions: dict[str, int] = {}
        self.fills: list[Fill]         = []
        self.equity_curve: list[float] = [initial_cash]
        self.snapshots: list[PortfolioSnapshot] = []
        self.peak_equity    = initial_cash
        self.engine         = QuantEngine()
        self.metrics        = PerformanceMetrics()

    def run_backtest(self, df: pd.DataFrame, symbol: str) -> dict:
        """
        Walk-forward backtest: re-analyzes at each bar, executes signals.
        Uses minimum 60 bars of warm-up to avoid look-ahead (§7.1 pitfalls).
        """
        WARMUP = 60
        if len(df) < WARMUP + 5:
            return {"error": "insufficient_data", "min_bars": WARMUP + 5}

        self._reset()
        bar_count = 0

        # Buy-and-hold benchmark: buy at warmup bar, hold to end
        warmup_price   = float(df["Close"].iloc[WARMUP])
        bnh_shares     = int(self.initial_cash / warmup_price)
        bnh_remainder  = self.initial_cash - bnh_shares * warmup_price
        self._bnh_snapshots: list[tuple[str, float]] = []

        for i in range(WARMUP, len(df)):
            window = df.iloc[:i]
            result = self.engine.analyze(window, symbol)
            current_price = float(df["Close"].iloc[i])
            ts = str(df.index[i])
            # Track buy-and-hold equity at same timestamps
            bnh_total = bnh_shares * current_price + bnh_remainder
            if i % 5 == 0:
                self._bnh_snapshots.append((ts, round(bnh_total, 2)))

            # Volume for slippage model
            current_volume = float(df["Volume"].iloc[i]) if "Volume" in df.columns else 1e6
            adv = float(df["Volume"].iloc[max(0, i-20):i].mean()) if "Volume" in df.columns else 1e6

            sig   = result.composite_signal
            conf  = result.composite_confidence
            kelly = result.position_size_pct / 100.0

            # Execute signal
            if sig == 1 and self.cash > current_price:
                qty = self._compute_qty(current_price, kelly)
                if qty > 0:
                    fill = self._buy(symbol, qty, current_price, adv, ts)
                    if fill:
                        self.fills.append(fill)

            elif sig == -1 and self.positions.get(symbol, 0) > 0:
                qty = self.positions[symbol]
                fill = self._sell(symbol, qty, current_price, adv, ts)
                if fill:
                    self.fills.append(fill)

            # Mark to market
            equity = self._mark_to_market({symbol: current_price})
            total  = self.cash + equity
            self.equity_curve.append(total)
            self.peak_equity = max(self.peak_equity, total)
            dd = (self.peak_equity - total) / (self.peak_equity + 1e-8)

            if i % 5 == 0:
                self.snapshots.append(PortfolioSnapshot(
                    timestamp=ts,
                    cash=round(self.cash, 2),
                    equity=round(equity, 2),
                    total=round(total, 2),
                    pnl=round(total - self.initial_cash, 2),
                    pnl_pct=round((total / self.initial_cash - 1) * 100, 3),
                    drawdown=round(dd * 100, 3),
                ))
            bar_count += 1

        return self._final_stats(symbol)

    def _buy(self, symbol: str, qty: int, price: float,
             adv: float, ts: str) -> Optional[Fill]:
        slip_bps   = self._slippage_bps(qty, price, adv, side="buy")
        fill_price = price * (1 + slip_bps / 10_000)
        commission = max(self.MIN_COMMISSION, qty * self.COMMISSION_PER_SHARE)
        cost       = qty * fill_price + commission

        if cost > self.cash:
            qty = int((self.cash - commission) / fill_price)
            if qty <= 0:
                return None
            cost = qty * fill_price + commission

        self.cash -= cost
        self.positions[symbol] = self.positions.get(symbol, 0) + qty

        return Fill(ts, symbol, "buy", qty, round(fill_price, 4),
                    round(commission, 2), round(slip_bps, 2),
                    round(qty * fill_price, 2))

    def _sell(self, symbol: str, qty: int, price: float,
              adv: float, ts: str) -> Optional[Fill]:
        slip_bps   = self._slippage_bps(qty, price, adv, side="sell")
        fill_price = price * (1 - slip_bps / 10_000)
        commission = max(self.MIN_COMMISSION, qty * self.COMMISSION_PER_SHARE)
        proceeds   = qty * fill_price - commission

        self.cash += proceeds
        self.positions[symbol] = self.positions.get(symbol, 0) - qty

        return Fill(ts, symbol, "sell", qty, round(fill_price, 4),
                    round(commission, 2), round(slip_bps, 2),
                    round(qty * fill_price, 2))

    def _compute_qty(self, price: float, kelly_fraction: float) -> int:
        alloc = self.cash * kelly_fraction
        return max(0, int(alloc / price))

    @staticmethod
    def _slippage_bps(qty: int, price: float, adv: float, side: str) -> float:
        """
        Market-impact model: slippage proportional to participation rate.
        As in QuantBasics §3 — ADV-normalized participation.
        """
        if adv <= 0:
            return 2.0
        notional = qty * price
        participation = notional / (adv * price)
        # Linear impact: ~5 bps per 1% participation, min 0.5 bps
        return max(0.5, participation * 500)

    def _mark_to_market(self, prices: dict) -> float:
        return sum(self.positions.get(sym, 0) * px for sym, px in prices.items())

    def _reset(self):
        self.cash         = self.initial_cash
        self.positions    = {}
        self.fills        = []
        self.equity_curve = [self.initial_cash]
        self.snapshots    = []
        self.peak_equity  = self.initial_cash

    def _final_stats(self, symbol: str) -> dict:
        curve = np.array(self.equity_curve)
        rets  = np.diff(curve) / (curve[:-1] + 1e-8)

        total_return  = (curve[-1] / self.initial_cash - 1) * 100
        sharpe        = self.metrics.sharpe(rets)
        sortino       = self.metrics.sortino(rets)
        max_dd        = self.metrics.max_drawdown(curve) * 100
        win_fills     = [f for f in self.fills if f.side == "sell"]
        trades        = self._pair_trades()

        win_rate      = 0.0
        avg_win       = 0.0
        avg_loss      = 0.0
        if trades:
            pnls     = [t["pnl"] for t in trades]
            wins     = [p for p in pnls if p > 0]
            losses   = [p for p in pnls if p <= 0]
            win_rate = len(wins) / len(pnls) * 100
            avg_win  = np.mean(wins)  if wins   else 0.0
            avg_loss = np.mean(losses) if losses else 0.0

        avg_slip = 0.0
        if self.fills:
            avg_slip = np.mean([f.slippage_bps for f in self.fills])

        # Buy-and-hold final return
        bnh_snaps  = getattr(self, "_bnh_snapshots", [])
        bnh_final  = bnh_snaps[-1][1] if bnh_snaps else self.initial_cash
        bnh_return = round((bnh_final / self.initial_cash - 1) * 100, 3)
        alpha      = round(total_return - bnh_return, 3)

        return {
            "symbol":         symbol,
            "initial_cash":   self.initial_cash,
            "final_value":    round(float(curve[-1]), 2),
            "total_return":   round(total_return, 3),
            "bnh_return":     bnh_return,
            "alpha":          alpha,
            "sharpe":         round(sharpe, 3),
            "sortino":        round(sortino, 3),
            "max_drawdown":   round(max_dd, 3),
            "win_rate":       round(win_rate, 1),
            "avg_win":        round(avg_win, 2),
            "avg_loss":       round(avg_loss, 2),
            "avg_slippage_bps": round(avg_slip, 2),
            "n_trades":       len(trades),
            "equity_curve":   [round(v, 2) for v in curve[::5]],
            "snapshots":      [
                {
                    "t": s.timestamp,
                    "total": s.total,
                    "pnl_pct": s.pnl_pct,
                    "drawdown": s.drawdown,
                    "bnh_pct": round((bnh_snaps[idx][1] / self.initial_cash - 1) * 100, 3)
                                if idx < len(bnh_snaps) else 0,
                }
                for idx, s in enumerate(self.snapshots)
            ],
            "fills": [
                {
                    "ts":    f.timestamp,
                    "side":  f.side,
                    "qty":   f.qty,
                    "price": f.price,
                    "slip":  f.slippage_bps,
                    "nv":    f.notional,
                }
                for f in self.fills
            ],
        }

    def _pair_trades(self) -> list[dict]:
        buys  = [f for f in self.fills if f.side == "buy"]
        sells = [f for f in self.fills if f.side == "sell"]
        pairs = []
        buy_q = list(buys)
        for sell in sells:
            if buy_q:
                buy = buy_q.pop(0)
                pnl = (sell.price - buy.price) * min(buy.qty, sell.qty)
                pairs.append({"buy_price": buy.price, "sell_price": sell.price, "pnl": pnl})
        return pairs
