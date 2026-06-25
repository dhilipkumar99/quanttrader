"""
intraday_agent.py — Single-stock intraday execution agent.

Finite state machine:
  WAITING       → polls for entry signal every 60 s from 9:45 AM ET
  IN_POSITION   → monitors stop/target/reversal every 30 s
  SCALING_OUT   → at 3:15 PM ET, closes 50% of position
  CLOSED        → all positions flat; session complete

User provides: symbol, direction (1=LONG / -1=SHORT), account size, risk config.
Algorithm provides: entry timing (ORB/VWAP/ATR signals from intraday_engine),
                    stop-loss order (submitted as bracket to broker at fill),
                    scale-out timing, forced EOD close.

Key safety properties:
  - Stop loss is submitted as a Alpaca stop-limit order at entry fill so the
    broker enforces it even if the Python process is interrupted.
  - Max 5 trades/day is a hard counter — agent stops entering after that.
  - Daily loss cap: agent halts if unrealized + realized loss > risk_per_trade_pct × max_trades.
  - Session summary (symbol, direction, trades, P&L, max drawdown) persisted to SQLite on close.
"""
from __future__ import annotations

import json
import logging
import os
import smtplib
import sqlite3
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.mime.text import MIMEText
from enum import Enum
from typing import Optional

log = logging.getLogger("intraday_agent")

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except ImportError:
    import datetime as _dt
    _ET = timezone(_dt.timedelta(hours=-4))   # EDT approximate


# ── State machine ─────────────────────────────────────────────────────────────

class AgentState(str, Enum):
    IDLE        = "idle"         # not started
    WAITING     = "waiting"      # looking for entry signal
    IN_POSITION = "in_position"  # position open, monitoring
    SCALING_OUT = "scaling_out"  # 3:15 PM — closed 50%, watching remainder
    CLOSED      = "closed"       # session complete, all flat
    ERROR       = "error"        # unrecoverable error


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class TradeRecord:
    ts:              str
    action:          str    # "entry_long" | "entry_short" | "stop_exit" | "target_exit" | "scale_out" | "eod_close" | "reversal_exit"
    qty:             int
    price:           float
    dollar_amount:   float
    stop_price:      float
    target_price:    float
    order_id:        str = ""
    dry_run:         bool = True
    reason:          str = ""
    pnl_pct:         float = 0.0  # filled in on exit trades


@dataclass
class IntradayConfig:
    symbol:              str
    direction:           int    # 1=LONG, -1=SHORT
    account_size:        float  # total account value in dollars
    risk_per_trade_pct:  float = 1.0    # % of account to risk per trade
    stop_atr_mult:       float = 1.5    # stop = ATR × this (mirrors engine default)
    max_trades:          int   = 5      # max entries allowed today
    dry_run:             bool  = True   # if False, submits real Alpaca orders
    notify_email:        str   = ""     # email for trade alerts (entry, exit, session end)


@dataclass
class IntradayStatus:
    state:          str = AgentState.IDLE
    symbol:         str = ""
    direction:      int = 0
    trades_today:   int = 0
    max_trades:     int = 5
    current_qty:    int = 0
    avg_entry_price: float = 0.0
    current_price:  float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pct: float = 0.0
    realized_pnl:   float = 0.0
    max_drawdown:   float = 0.0   # worst intraday equity trough (negative = loss)
    stop_price:     float = 0.0
    target_price:   float = 0.0
    last_signal_reason: str = ""
    last_update:    str = ""
    error:          str = ""
    trades:         list[dict] = field(default_factory=list)
    context:        dict = field(default_factory=dict)


# ── Singleton agent ───────────────────────────────────────────────────────────

class IntradayAgent:
    """
    Single-stock intraday execution agent.

    One instance per server process, accessed via module-level get_agent().
    Only one session can be active at a time — calling start() while running
    raises ValueError.
    """

    def __init__(self) -> None:
        self._lock   = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._status = IntradayStatus()
        self._config: Optional[IntradayConfig] = None
        self._trades: list[TradeRecord] = []
        self._realized_pnl = 0.0
        self._peak_equity  = 0.0   # highest combined P&L seen intraday (for drawdown calc)
        self._max_drawdown = 0.0   # most negative excursion from peak (stored as negative $)

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self, config: IntradayConfig) -> None:
        """Start a new intraday session. Raises if already running."""
        with self._lock:
            if self._status.state in (AgentState.WAITING, AgentState.IN_POSITION, AgentState.SCALING_OUT):
                raise ValueError(f"Agent already running in state {self._status.state}. Call stop() first.")
            self._config = config
            self._trades = []
            self._realized_pnl = 0.0
            self._peak_equity  = 0.0
            self._max_drawdown = 0.0
            self._stop_event.clear()
            self._status = IntradayStatus(
                state     = AgentState.WAITING,
                symbol    = config.symbol,
                direction = config.direction,
                max_trades= config.max_trades,
            )
            self._thread = threading.Thread(target=self._run, daemon=True, name="intraday-agent")
            self._thread.start()

    def stop(self) -> None:
        """Signal the agent to stop after completing any in-progress action."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
        with self._lock:
            if self._status.state not in (AgentState.CLOSED, AgentState.ERROR):
                self._status.state = AgentState.CLOSED
                self._status.last_update = _now_et()

    def get_status(self) -> dict:
        with self._lock:
            s = self._status
            return {
                "state":              s.state,
                "symbol":             s.symbol,
                "direction":          s.direction,
                "direction_word":     "LONG" if s.direction == 1 else "SHORT" if s.direction == -1 else "NONE",
                "trades_today":       s.trades_today,
                "max_trades":         s.max_trades,
                "current_qty":        s.current_qty,
                "avg_entry_price":    s.avg_entry_price,
                "current_price":      s.current_price,
                "unrealized_pnl":     round(s.unrealized_pnl, 2),
                "unrealized_pct":     round(s.unrealized_pct, 2),
                "realized_pnl":       round(s.realized_pnl, 2),
                "max_drawdown":       round(s.max_drawdown, 2),
                "stop_price":         s.stop_price,
                "target_price":       s.target_price,
                "last_signal_reason": s.last_signal_reason,
                "last_update":        s.last_update,
                "error":              s.error,
                "trades":             [_trade_dict(t) for t in self._trades],
                "context":            s.context,
            }

    # ── Main FSM loop ─────────────────────────────────────────────────────────

    def _run(self) -> None:
        try:
            self._fsm_loop()
        except Exception as e:
            log.exception("IntradayAgent unhandled error: %s", e)
            with self._lock:
                self._status.state = AgentState.ERROR
                self._status.error = str(e)
                self._status.last_update = _now_et()
        finally:
            # Persist session summary regardless of how FSM ended
            if self._config is not None and self._status.trades_today > 0:
                _persist_session(self._status, self._config, self._trades, self._max_drawdown)
                # Session end email
                if self._config.notify_email:
                    threading.Thread(
                        target=_session_end_email,
                        args=(self._config.notify_email, self._config, self._status),
                        daemon=True,
                    ).start()

    def _fsm_loop(self) -> None:
        from api.quant.intraday_engine import IntradayEngine
        engine = IntradayEngine()
        _gap_checked = False  # run gap-against-direction check once, after bars arrive

        while not self._stop_event.is_set():
            now_et = datetime.now(_ET)
            state  = self._status.state

            # ── Market closed / session over ──
            if now_et.hour >= 16 or (now_et.hour == 15 and now_et.minute >= 45):
                if state not in (AgentState.CLOSED, AgentState.IDLE):
                    self._force_close_all("eod_close", "3:45 PM ET end-of-day close")
                self._set_state(AgentState.CLOSED)
                break

            # ── Too early — market not open yet ──
            if now_et.hour < 9 or (now_et.hour == 9 and now_et.minute < 30):
                time.sleep(30)
                continue

            # ── Fetch 1-min bars ──
            try:
                df, data_source = self._fetch_bars()
                if df.empty:
                    self._update_last("no intraday data yet — waiting")
                    time.sleep(15)
                    continue
            except Exception as fe:
                log.warning("Intraday bar fetch error: %s", fe)
                time.sleep(15)
                continue

            # ── Update context (VWAP, RSI, ORB etc.) ──
            ctx = engine.get_context(df)
            with self._lock:
                self._status.context = ctx
                self._status.current_price = ctx.get("price", 0.0)

            # ── Gap-against-direction check (run once after bars arrive) ──
            if not _gap_checked and len(df) >= 2:
                _gap_checked = True
                self._check_open_gap(df)

            # ── Update unrealized P&L ──
            self._refresh_unrealized(ctx.get("price", 0.0))

            # ── Scale-out window: 3:15–3:44 ──
            in_scale_window = now_et.hour == 15 and now_et.minute >= 15

            # ── STATE: WAITING ────────────────────────────────────────────────
            if state == AgentState.WAITING:
                # Skip first 15 minutes (let opening range form)
                if now_et.hour == 9 and now_et.minute < 45:
                    self._update_last("waiting for opening range to establish (9:45 AM start)")
                    time.sleep(15)
                    continue

                if self._status.trades_today >= self._config.max_trades:
                    self._update_last(f"max trades reached ({self._config.max_trades}) — session complete")
                    self._set_state(AgentState.CLOSED)
                    break

                # Check daily loss cap
                if self._daily_loss_exceeded():
                    self._update_last("daily loss cap hit — no more entries today")
                    self._set_state(AgentState.CLOSED)
                    break

                # Account-level circuit breaker — halt entries if account equity
                # has dropped more than the configured threshold from prior close
                try:
                    from api.quant.circuit_breaker import check_and_trip
                    if check_and_trip():
                        self._update_last(
                            "CIRCUIT BREAKER: account equity drawdown threshold exceeded — "
                            "halting all entries. Reset via /api/circuit-breaker/reset."
                        )
                        self._set_state(AgentState.CLOSED)
                        break
                except Exception:
                    pass  # never let breaker check block the FSM

                sig = engine.evaluate(df, user_direction=self._config.direction)
                self._update_signal_reason(sig.reason)

                if sig.direction != 0 and sig.direction == self._config.direction:
                    # Signal agrees with user's bias — attempt entry
                    qty = self._compute_qty(sig.entry_price, sig.stop_price)
                    if qty >= 1:
                        entered = self._enter_position(sig, qty)
                        if entered:
                            self._set_state(AgentState.IN_POSITION)
                            time.sleep(30)  # brief pause after fill before monitoring
                            continue

                time.sleep(60)  # poll every 60 s in waiting state

            # ── STATE: IN_POSITION ────────────────────────────────────────────
            elif state == AgentState.IN_POSITION:
                price = ctx.get("price", 0.0)
                if price <= 0:
                    time.sleep(10)
                    continue

                direction = self._config.direction
                stop  = self._status.stop_price
                tgt   = self._status.target_price

                # Stop hit?
                stop_hit = (direction == 1  and price <= stop) or \
                           (direction == -1 and price >= stop)
                # Target hit?
                tgt_hit  = (direction == 1  and price >= tgt)  or \
                           (direction == -1 and price <= tgt)

                if stop_hit:
                    self._exit_position("stop_exit", price, "stop loss hit")
                    self._set_state(AgentState.WAITING)

                elif tgt_hit:
                    self._exit_position("target_exit", price, "take-profit target reached")
                    self._set_state(AgentState.WAITING)

                elif in_scale_window:
                    # 3:15 PM — close 50%, let the other half run to 3:45
                    self._scale_out(price)
                    self._set_state(AgentState.SCALING_OUT)

                else:
                    # Check for reversal: if signal now fires in the OPPOSITE direction, exit
                    sig = engine.evaluate(df, user_direction=0)
                    if sig.direction != 0 and sig.direction != direction:
                        self._exit_position("reversal_exit", price, f"reversal signal: {sig.reason[:80]}")
                        self._set_state(AgentState.WAITING)

                time.sleep(30)  # monitor every 30 s

            # ── STATE: SCALING_OUT ────────────────────────────────────────────
            elif state == AgentState.SCALING_OUT:
                price = ctx.get("price", 0.0)
                if price <= 0:
                    time.sleep(10)
                    continue

                direction = self._config.direction
                stop  = self._status.stop_price
                stop_hit = (direction == 1  and price <= stop) or \
                           (direction == -1 and price >= stop)

                if stop_hit:
                    self._exit_position("stop_exit", price, "stop loss hit (remaining half)")
                    self._set_state(AgentState.CLOSED)
                    break

                if now_et.hour == 15 and now_et.minute >= 44:
                    self._force_close_all("eod_close", "3:45 PM final close (remaining half)")
                    self._set_state(AgentState.CLOSED)
                    break

                time.sleep(30)

            elif state in (AgentState.CLOSED, AgentState.ERROR, AgentState.IDLE):
                break

        log.info("IntradayAgent FSM loop ended. State: %s", self._status.state)

    # ── Order helpers ─────────────────────────────────────────────────────────

    def _check_open_gap(self, df) -> None:
        """
        Compare today's first bar open to the prior bar's close.
        If the stock gapped >1% against the user's intended direction,
        surface a warning in last_signal_reason so the UI displays it.
        The warning is informational only — it does not halt the agent.
        """
        try:
            if len(df) < 2:
                return
            prior_close = float(df["Close"].iloc[-2])
            today_open  = float(df["Open"].iloc[-1])
            if prior_close <= 0:
                return
            gap_pct = (today_open - prior_close) / prior_close * 100
            direction = self._config.direction
            # Positive gap hurts a SHORT; negative gap hurts a LONG
            adverse = (direction == 1 and gap_pct < -1.0) or \
                      (direction == -1 and gap_pct > 1.0)
            if adverse:
                word = "down" if gap_pct < 0 else "up"
                msg = (f"WARNING: Stock gapped {word} {abs(gap_pct):.1f}% at open against your "
                       f"{'LONG' if direction == 1 else 'SHORT'} bias. "
                       f"Signals are still active — consider waiting for re-test of gap level.")
                log.warning("Open gap warning: %s", msg)
                self._update_last(msg)
        except Exception as e:
            log.debug("Gap check skipped: %s", e)

    def _fetch_bars(self):
        from api.quant.ohlcv_store import get_intraday_bars
        return get_intraday_bars(self._config.symbol)

    def _compute_qty(self, entry_price: float, stop_price: float) -> int:
        """
        Position size = (account_size × risk_per_trade_pct/100) / stop_distance_per_share.
        Never more than 20% of account in one position regardless of risk settings.
        """
        if entry_price <= 0 or stop_price <= 0:
            return 0
        stop_dist = abs(entry_price - stop_price)
        if stop_dist < 0.01:
            return 0
        risk_dollars = self._config.account_size * (self._config.risk_per_trade_pct / 100)
        qty = int(risk_dollars / stop_dist)
        # Cap: never put more than 20% of account into one trade
        max_dollars = self._config.account_size * 0.20
        max_qty = int(max_dollars / entry_price) if entry_price > 0 else 0
        return min(qty, max_qty)

    def _enter_position(self, sig, qty: int) -> bool:
        """
        Submit entry as an atomic bracket order (entry + stop + target in one request).

        For live orders:
          1. submit_bracket_order() — one Alpaca call; if it fails, nothing goes on.
          2. poll_fill() — confirms the entry leg actually filled and captures the
             real fill price and qty (handles partial fills).
          3. Only after confirmed fill does position state update.

        For dry-run: simulates fill at sig.entry_price immediately.
        """
        cfg = self._config
        side   = "buy"  if cfg.direction == 1 else "sell"
        intent = "buy_to_open" if cfg.direction == 1 else "sell_to_open"

        if cfg.dry_run:
            order_id    = "dry-run"
            filled_qty   = qty
            filled_price = sig.entry_price
            log.info("[DRY] BRACKET %s %d %s @ %.2f stop=%.2f target=%.2f",
                     intent.upper(), qty, cfg.symbol,
                     sig.entry_price, sig.stop_price, sig.target_price)
        else:
            from api.quant.broker import submit_bracket_order, poll_fill

            # Step 1: submit atomic bracket — entry + stop + target in one request
            result = submit_bracket_order(
                symbol         = cfg.symbol,
                qty            = qty,
                side           = side,
                stop_price     = sig.stop_price,
                target_price   = sig.target_price,
                position_intent= intent,
            )
            if "error" in result:
                log.error("Bracket order failed — no position opened: %s", result)
                self._update_last(f"Entry rejected: {result.get('message', result['error'])}")
                return False

            order_id = result["id"]

            # Step 2: poll for actual fill (handles partial fills and network delays)
            fill = poll_fill(order_id, timeout_seconds=10.0)
            if "error" in fill:
                log.error("Fill not confirmed for %s: %s — aborting position update", order_id, fill)
                self._update_last(f"Fill unconfirmed ({fill.get('error')}) — position NOT recorded. Check Alpaca dashboard.")
                return False

            filled_qty   = int(fill["filled_qty"])
            filled_price = float(fill["filled_avg_price"])

            if filled_qty < 1:
                log.error("Zero fill qty for order %s — aborting", order_id)
                return False

            log.info("Bracket fill confirmed: %d/%d shares @ %.4f (order %s)",
                     filled_qty, qty, filled_price, order_id)

        dollar = filled_qty * filled_price
        trade = TradeRecord(
            ts=_now_et(), action=f"entry_{'long' if cfg.direction == 1 else 'short'}",
            qty=filled_qty, price=filled_price, dollar_amount=dollar,
            stop_price=sig.stop_price, target_price=sig.target_price,
            order_id=order_id, dry_run=cfg.dry_run, reason=sig.reason[:200],
        )
        with self._lock:
            self._trades.append(trade)
            self._status.trades_today    += 1
            self._status.current_qty     = filled_qty if cfg.direction == 1 else -filled_qty
            self._status.avg_entry_price  = filled_price
            self._status.stop_price      = sig.stop_price
            self._status.target_price    = sig.target_price
            self._status.last_update     = _now_et()

        # Email alert on every entry (runs in background thread to never block FSM)
        if cfg.notify_email:
            threading.Thread(
                target=_entry_email, args=(cfg.notify_email, cfg, trade), daemon=True
            ).start()

        return True

    def _exit_position(self, action: str, price: float, reason: str) -> None:
        """Close the full current position."""
        cfg = self._config
        with self._lock:
            qty = abs(self._status.current_qty)
            entry = self._status.avg_entry_price

        if qty < 1:
            return

        side   = "sell" if cfg.direction == 1 else "buy"
        intent = "sell_to_close" if cfg.direction == 1 else "buy_to_cover"

        fill_price = price  # default: last-known bar price (dry-run / fallback)
        if cfg.dry_run:
            order_id = "dry-run"
        else:
            from api.quant.broker import submit_order, poll_fill
            result = submit_order(cfg.symbol, qty, side, "market",
                                  time_in_force="day", position_intent=intent)
            if "error" in result:
                log.error("Exit order failed for %s: %s", cfg.symbol, result)
                order_id = "failed"
            else:
                order_id = result.get("id", "")
                fill = poll_fill(order_id, timeout_seconds=10.0)
                if "error" not in fill and float(fill.get("filled_avg_price", 0)) > 0:
                    fill_price = float(fill["filled_avg_price"])

        directed_ret = ((fill_price - entry) / entry * 100) if cfg.direction == 1 \
                  else ((entry - fill_price) / entry * 100)

        trade = TradeRecord(
            ts=_now_et(), action=action, qty=qty, price=fill_price,
            dollar_amount=qty * price,
            stop_price=self._status.stop_price, target_price=self._status.target_price,
            order_id=order_id, dry_run=cfg.dry_run,
            reason=reason[:200], pnl_pct=round(directed_ret, 3),
        )
        pnl_dollars = qty * entry * (directed_ret / 100)

        with self._lock:
            self._trades.append(trade)
            self._realized_pnl          += pnl_dollars
            self._status.realized_pnl    = round(self._realized_pnl, 2)
            self._status.current_qty     = 0
            self._status.avg_entry_price = 0.0
            self._status.unrealized_pnl  = 0.0
            self._status.unrealized_pct  = 0.0
            self._status.last_update     = _now_et()

        # Email alert on every exit
        if self._config and self._config.notify_email:
            threading.Thread(
                target=_exit_email,
                args=(self._config.notify_email, self._config, trade, round(self._realized_pnl, 2)),
                daemon=True,
            ).start()

    def _scale_out(self, price: float) -> None:
        """Close 50% of the position at 3:15 PM."""
        cfg = self._config
        with self._lock:
            full_qty = abs(self._status.current_qty)

        half_qty = max(1, full_qty // 2)
        side   = "sell" if cfg.direction == 1 else "buy"
        intent = "sell_to_close" if cfg.direction == 1 else "buy_to_cover"

        scale_fill_price = price  # default: last-known bar price (dry-run / fallback)
        if not cfg.dry_run:
            from api.quant.broker import submit_order, poll_fill
            result = submit_order(cfg.symbol, half_qty, side, "market",
                                  time_in_force="day", position_intent=intent)
            if "error" not in result:
                fill = poll_fill(result.get("id", ""), timeout_seconds=10.0)
                if "error" not in fill and float(fill.get("filled_avg_price", 0)) > 0:
                    scale_fill_price = float(fill["filled_avg_price"])

        entry = self._status.avg_entry_price
        directed_ret = ((scale_fill_price - entry) / entry * 100) if cfg.direction == 1 \
                  else ((entry - scale_fill_price) / entry * 100)

        trade = TradeRecord(
            ts=_now_et(), action="scale_out", qty=half_qty, price=scale_fill_price,
            dollar_amount=half_qty * scale_fill_price,
            stop_price=self._status.stop_price, target_price=self._status.target_price,
            order_id="dry-run" if cfg.dry_run else "", dry_run=cfg.dry_run,
            reason="3:15 PM scale-out: closing 50% of position",
            pnl_pct=round(directed_ret, 3),
        )
        pnl_dollars = half_qty * entry * (directed_ret / 100)

        with self._lock:
            self._trades.append(trade)
            self._realized_pnl         += pnl_dollars
            self._status.realized_pnl   = round(self._realized_pnl, 2)
            remaining = full_qty - half_qty
            self._status.current_qty    = remaining if cfg.direction == 1 else -remaining
            self._status.last_update    = _now_et()

    def _force_close_all(self, action: str, reason: str) -> None:
        """Close 100% of any open position (end-of-day or emergency)."""
        with self._lock:
            qty = abs(self._status.current_qty)
        if qty < 1:
            return
        # Fetch last price from context
        price = self._status.current_price or self._status.avg_entry_price
        self._exit_position(action, price, reason)

    def _refresh_unrealized(self, current_price: float) -> None:
        with self._lock:
            qty   = self._status.current_qty  # +ve=long, -ve=short
            entry = self._status.avg_entry_price
            if qty == 0 or entry <= 0 or current_price <= 0:
                return
            direction = 1 if qty > 0 else -1
            directed  = ((current_price - entry) / entry * 100) * direction
            unrealized = round(abs(qty) * entry * directed / 100, 2)
            self._status.unrealized_pnl = unrealized
            self._status.unrealized_pct = round(directed, 3)
            self._status.current_price  = current_price

            # Track intraday max drawdown: worst equity trough from the session peak
            total_equity = self._realized_pnl + unrealized
            if total_equity > self._peak_equity:
                self._peak_equity = total_equity
            drawdown = total_equity - self._peak_equity  # ≤0
            if drawdown < self._max_drawdown:
                self._max_drawdown = drawdown
                self._status.max_drawdown = round(drawdown, 2)

    def _daily_loss_exceeded(self) -> bool:
        """
        Halt if total session loss (realized + unrealized) exceeds
        max_trades × risk_per_trade_pct of account.

        Both realized_pnl and unrealized_pnl are signed (negative = loss).
        Loss exposure = -(realized + min(0, unrealized)):
          - Always counts realized losses.
          - Counts unrealized losses but ignores unrealized gains (conservative).
        """
        cfg = self._config
        cap = cfg.account_size * (cfg.risk_per_trade_pct / 100) * cfg.max_trades
        unrealized_loss = min(0.0, self._status.unrealized_pnl)  # ≤0, 0 if in profit
        total_loss = -(self._realized_pnl + unrealized_loss)      # positive = loss dollars
        return total_loss >= cap

    def _update_last(self, msg: str) -> None:
        with self._lock:
            self._status.last_signal_reason = msg
            self._status.last_update        = _now_et()

    def _update_signal_reason(self, reason: str) -> None:
        with self._lock:
            self._status.last_signal_reason = reason
            self._status.last_update        = _now_et()

    def _set_state(self, state: AgentState) -> None:
        with self._lock:
            self._status.state       = state
            self._status.last_update = _now_et()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_et() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d %H:%M:%S ET")


# ── Email notifications ───────────────────────────────────────────────────────
# Supports two transports (tried in order):
#   1. Resend HTTP API  — set RESEND_API_KEY + NOTIFY_FROM in .env.local
#   2. SMTP             — set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
# Falls back silently if neither is configured.

def _send_intraday_email(to: str, subject: str, body: str) -> None:
    """Fire-and-forget email. Never raises — logged on failure."""
    if not to:
        return

    # ── Transport 1: Resend (preferred — simple HTTP, no SMTP config needed) ──
    resend_key  = os.environ.get("RESEND_API_KEY", "")
    notify_from = os.environ.get("NOTIFY_FROM", "QuantTrader <noreply@quanttrader.app>")
    if resend_key:
        try:
            payload = json.dumps({
                "from":    notify_from,
                "to":      [to],
                "subject": subject,
                "text":    body,
            }).encode()
            req = urllib.request.Request(
                "https://api.resend.com/emails",
                data    = payload,
                headers = {
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type":  "application/json",
                },
                method  = "POST",
            )
            with urllib.request.urlopen(req, timeout=8):
                pass
            log.info("Intraday email sent via Resend to %s: %s", to, subject)
            return
        except Exception as e:
            log.warning("Resend send failed: %s — trying SMTP fallback", e)

    # ── Transport 2: SMTP fallback ────────────────────────────────────────────
    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "")
    pw   = os.environ.get("SMTP_PASS", "")
    if not all([host, user, pw]):
        return
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"]    = user
        msg["To"]      = to
        with smtplib.SMTP(host, port, timeout=10) as s:
            s.starttls()
            s.login(user, pw)
            s.sendmail(user, [to], msg.as_string())
        log.info("Intraday email sent via SMTP to %s: %s", to, subject)
    except Exception as e:
        log.warning("SMTP send failed: %s", e)


def _entry_email(to: str, cfg: "IntradayConfig", trade: "TradeRecord") -> None:
    dir_word = "LONG" if cfg.direction == 1 else "SHORT"
    subject  = f"[QuantTrader] {dir_word} {cfg.symbol} — position opened @ ${trade.price:.2f}"
    body = (
        f"QuantTrader Intraday Agent — Position Opened\n"
        f"{'─' * 50}\n\n"
        f"  Symbol     {cfg.symbol}\n"
        f"  Direction  {dir_word}\n"
        f"  Shares     {trade.qty}\n"
        f"  Entry      ${trade.price:.2f}\n"
        f"  Position   ${trade.dollar_amount:,.2f}\n"
        f"  Stop loss  ${trade.stop_price:.2f}\n"
        f"  Target     ${trade.target_price:.2f}\n"
        f"  Mode       {'DRY RUN — no real orders' if cfg.dry_run else 'LIVE'}\n"
        f"  Signal     {trade.reason[:120]}\n\n"
        f"{'─' * 50}\n"
        f"Sent by QuantTrader · {_now_et()}\n"
        f"Manage settings in QuantTrader → Agent → Config\n"
    )
    _send_intraday_email(to, subject, body)


def _exit_email(to: str, cfg: "IntradayConfig", trade: "TradeRecord", session_pnl: float) -> None:
    dir_word = "LONG" if cfg.direction == 1 else "SHORT"
    action   = trade.action.replace("_", " ").upper()
    pnl_str  = f"+{session_pnl:,.2f}" if session_pnl >= 0 else f"{session_pnl:,.2f}"
    subject  = f"[QuantTrader] {cfg.symbol} {action} — P&L {pnl_str}"
    body = (
        f"QuantTrader Intraday Agent — Position Closed\n"
        f"{'─' * 50}\n\n"
        f"  Symbol         {cfg.symbol}\n"
        f"  Action         {action}\n"
        f"  Shares         {trade.qty}\n"
        f"  Exit price     ${trade.price:.2f}\n"
        f"  P&L this trade {'+' if trade.pnl_pct >= 0 else ''}{trade.pnl_pct:.2f}%\n"
        f"  Session P&L    ${pnl_str}\n"
        f"  Reason         {trade.reason[:120]}\n"
        f"  Mode           {'DRY RUN' if cfg.dry_run else 'LIVE'}\n\n"
        f"{'─' * 50}\n"
        f"Sent by QuantTrader · {_now_et()}\n"
    )
    _send_intraday_email(to, subject, body)


def _session_end_email(to: str, cfg: "IntradayConfig", status: "IntradayStatus") -> None:
    dir_word = "LONG" if cfg.direction == 1 else "SHORT"
    pnl      = status.realized_pnl
    pnl_str  = f"+${pnl:,.2f}" if pnl >= 0 else f"-${abs(pnl):,.2f}"
    result   = "profitable" if pnl > 0 else "breakeven" if pnl == 0 else "a loss"
    subject  = f"[QuantTrader] {cfg.symbol} session ended — {pnl_str}"
    body = (
        f"QuantTrader Intraday Session Summary\n"
        f"{'═' * 50}\n\n"
        f"  Symbol         {cfg.symbol}\n"
        f"  Direction      {dir_word}\n"
        f"  Total trades   {status.trades_today}\n"
        f"  Realized P&L   {pnl_str}\n"
        f"  Max drawdown   ${status.max_drawdown:,.2f}\n"
        f"  Mode           {'DRY RUN' if cfg.dry_run else 'LIVE'}\n\n"
        f"Today was {result}.\n\n"
        f"{'─' * 50}\n"
        f"Full trade log available in QuantTrader → Intraday → History\n"
        f"Sent by QuantTrader · {_now_et()}\n"
    )
    _send_intraday_email(to, subject, body)


def _trade_dict(t: TradeRecord) -> dict:
    return {
        "ts":            t.ts,
        "action":        t.action,
        "qty":           t.qty,
        "price":         t.price,
        "dollar_amount": round(t.dollar_amount, 2),
        "stop_price":    t.stop_price,
        "target_price":  t.target_price,
        "order_id":      t.order_id,
        "dry_run":       t.dry_run,
        "reason":        t.reason,
        "pnl_pct":       t.pnl_pct,
    }


# ── Session history persistence ───────────────────────────────────────────────

_HISTORY_DB = os.path.join(os.path.dirname(__file__), "..", "..", "data", "intraday_history.db")
_HISTORY_DB = os.path.abspath(_HISTORY_DB)

def _ensure_history_db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_HISTORY_DB), exist_ok=True)
    conn = sqlite3.connect(_HISTORY_DB, check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            date          TEXT NOT NULL,
            symbol        TEXT NOT NULL,
            direction     INTEGER NOT NULL,
            trades        INTEGER NOT NULL,
            realized_pnl  REAL NOT NULL,
            max_drawdown  REAL NOT NULL,
            dry_run       INTEGER NOT NULL,
            trade_log     TEXT NOT NULL,
            closed_at     TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def _persist_session(status: IntradayStatus, config: IntradayConfig,
                     trades: list[TradeRecord], max_drawdown: float) -> None:
    """Write a completed session summary to the history DB."""
    try:
        conn = _ensure_history_db()
        date = datetime.now(_ET).strftime("%Y-%m-%d")
        conn.execute(
            """INSERT INTO sessions
               (date, symbol, direction, trades, realized_pnl, max_drawdown, dry_run, trade_log, closed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                config.symbol,
                config.direction,
                status.trades_today,
                round(status.realized_pnl, 2),
                round(max_drawdown, 2),
                int(config.dry_run),
                json.dumps([_trade_dict(t) for t in trades]),
                _now_et(),
            ),
        )
        conn.commit()
        conn.close()
        log.info("Session history saved: %s %s P&L=%.2f DD=%.2f",
                 config.symbol, "LONG" if config.direction == 1 else "SHORT",
                 status.realized_pnl, max_drawdown)
    except Exception as e:
        log.warning("Failed to persist session history: %s", e)


def get_session_history(limit: int = 30) -> list[dict]:
    """Return the most recent `limit` completed sessions, newest first."""
    try:
        conn = _ensure_history_db()
        rows = conn.execute(
            """SELECT date, symbol, direction, trades, realized_pnl, max_drawdown,
                      dry_run, closed_at
               FROM sessions ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        conn.close()
        return [
            {
                "date":         r[0],
                "symbol":       r[1],
                "direction":    r[2],
                "direction_word": "LONG" if r[2] == 1 else "SHORT",
                "trades":       r[3],
                "realized_pnl": r[4],
                "max_drawdown": r[5],
                "dry_run":      bool(r[6]),
                "closed_at":    r[7],
            }
            for r in rows
        ]
    except Exception as e:
        log.warning("Failed to read session history: %s", e)
        return []


# ── Module-level singleton ────────────────────────────────────────────────────

_agent: Optional[IntradayAgent] = None
_agent_lock = threading.Lock()


def get_agent() -> IntradayAgent:
    global _agent
    with _agent_lock:
        if _agent is None:
            _agent = IntradayAgent()
        return _agent
