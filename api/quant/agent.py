"""
Auto-trade agent — polls the quant engine on a watchlist of symbols,
submits Kelly-sized Alpaca orders when signals cross configured thresholds,
writes every decision to a JSON trade journal, and can produce a morning digest.

All state is persisted to agent_state.json next to this file so restarts survive.
"""
from __future__ import annotations

import json
import os
import smtplib
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.mime.text import MIMEText
from typing import Any

# Prefer /tmp (writable on Vercel/Lambda) — fall back to alongside this file for local dev
_STATE_PATH = (
    "/tmp/agent_state.json"
    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    else os.path.join(os.path.dirname(__file__), "agent_state.json")
)

# ── Default config ────────────────────────────────────────────────────────────

@dataclass
class AgentConfig:
    enabled: bool          = False          # master on/off switch
    symbols: list[str]     = field(default_factory=lambda: ["AAPL", "NVDA", "MSFT"])
    poll_interval_min: int = 15             # minutes between scans
    min_confidence: float  = 0.70           # 0–1; below this → no trade
    min_signal: int        = 1              # 1=LONG only, -1=both directions
    kelly_cap_pct: float   = 20.0           # hard cap: never risk > X% of portfolio per trade
    allow_short: bool      = False          # whether to submit sell orders
    dry_run: bool          = True           # compute + log but never actually submit
    notify_email: str      = ""             # optional — future use


@dataclass
class JournalEntry:
    ts: str
    symbol: str
    side: str                       # buy / sell / skip / error
    qty: int
    price: float
    dollar_amount: float
    signal: int
    confidence: float
    kelly_pct: float
    regime: str
    reason: str                     # plain-English explanation
    order_id: str = ""
    dry_run: bool = False


@dataclass
class AgentState:
    config: AgentConfig = field(default_factory=AgentConfig)
    journal: list[JournalEntry] = field(default_factory=list)
    last_run_ts: str = ""
    last_run_summary: str = ""
    running: bool = False
    error: str = ""


# ── Persistence ───────────────────────────────────────────────────────────────

def _load_state() -> AgentState:
    if not os.path.exists(_STATE_PATH):
        return AgentState()
    try:
        with open(_STATE_PATH) as f:
            raw = json.load(f)
        cfg = AgentConfig(**{k: v for k, v in raw.get("config", {}).items() if k in AgentConfig.__dataclass_fields__})
        journal = [JournalEntry(**e) for e in raw.get("journal", [])]
        return AgentState(
            config=cfg,
            journal=journal,
            last_run_ts=raw.get("last_run_ts", ""),
            last_run_summary=raw.get("last_run_summary", ""),
            running=False,  # never restore running=True on restart
            error=raw.get("error", ""),
        )
    except Exception:
        return AgentState()


def _save_state(state: AgentState) -> None:
    data = {
        "config": asdict(state.config),
        "journal": [asdict(e) for e in state.journal[-500:]],  # keep last 500 entries
        "last_run_ts": state.last_run_ts,
        "last_run_summary": state.last_run_summary,
        "running": state.running,
        "error": state.error,
    }
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, _STATE_PATH)


# ── Core agent logic ──────────────────────────────────────────────────────────

class AgentLoop:
    """
    Singleton. Import and call AgentLoop.instance() to get it.
    The agent runs in a background daemon thread when enabled.
    """
    _inst: "AgentLoop | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._state = _load_state()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        # Start background thread immediately — it will wait if disabled
        self._start_thread()

    @classmethod
    def instance(cls) -> "AgentLoop":
        with cls._lock:
            if cls._inst is None:
                cls._inst = cls()
        return cls._inst

    # ── Public API ─────────────────────────────────────────────────────────

    def get_config(self) -> dict:
        return asdict(self._state.config)

    def set_config(self, updates: dict) -> dict:
        cfg = self._state.config
        for k, v in updates.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
        _save_state(self._state)
        # Restart thread so new poll_interval takes effect
        self._restart_thread()
        return asdict(cfg)

    def get_status(self) -> dict:
        s = self._state
        return {
            "running":           s.running,
            "enabled":           s.config.enabled,
            "last_run_ts":       s.last_run_ts,
            "last_run_summary":  s.last_run_summary,
            "journal_count":     len(s.journal),
            "error":             s.error,
            "dry_run":           s.config.dry_run,
        }

    def get_journal(self, limit: int = 50) -> list[dict]:
        return [asdict(e) for e in reversed(self._state.journal[-limit:])]

    def run_once(self) -> dict:
        """Synchronous one-shot execution — called from the API for manual triggers."""
        return self._execute_cycle()

    def get_digest(self) -> dict:
        """Morning digest: latest signal for each watched symbol."""
        from api.quant.data import fetch, fetch_quote
        engine = _get_engine()
        results = []
        for sym in self._state.config.symbols:
            try:
                df = fetch(sym, period="6mo", interval="1d")
                if df.empty:
                    continue
                r = engine.analyze(df, sym)
                q = fetch_quote(sym)
                sig_word = "LONG" if r.composite_signal == 1 else "SHORT" if r.composite_signal == -1 else "FLAT"
                results.append({
                    "symbol":     sym,
                    "price":      q.get("price", 0),
                    "change_pct": q.get("change_pct", 0),
                    "signal":     r.composite_signal,
                    "signal_word": sig_word,
                    "confidence": round(r.composite_confidence, 3),
                    "regime":     r.regime,
                    "kelly_pct":  r.position_size_pct,
                    "actionable": r.composite_signal != 0 and r.composite_confidence >= self._state.config.min_confidence,
                })
            except Exception as e:
                results.append({"symbol": sym, "error": str(e)})
        longs  = [r for r in results if r.get("signal") == 1 and r.get("actionable")]
        shorts = [r for r in results if r.get("signal") == -1 and r.get("actionable")]
        return {
            "generated_at": _now(),
            "symbols_scanned": len(results),
            "actionable_longs":  len(longs),
            "actionable_shorts": len(shorts),
            "results": results,
            "headline": _digest_headline(longs, shorts),
        }

    # ── Background thread ──────────────────────────────────────────────────

    def _start_thread(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="agent-loop")
        self._thread.start()

    def _restart_thread(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._start_thread()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            cfg = self._state.config
            if cfg.enabled:
                try:
                    self._execute_cycle()
                except Exception as e:
                    self._state.error = str(e)
                    self._state.running = False
                    _save_state(self._state)
            interval_s = self._state.config.poll_interval_min * 60
            self._stop_event.wait(timeout=interval_s)

    # ── Execution cycle ────────────────────────────────────────────────────

    def _execute_cycle(self) -> dict:
        from api.quant.data import fetch, fetch_quote
        from api.quant.broker import get_account, get_positions, submit_order, is_shortable

        cfg = self._state.config
        self._state.running = True
        self._state.error = ""
        _save_state(self._state)

        engine = _get_engine()
        account = get_account()
        portfolio_value = account.portfolio_value if account else 0.0
        buying_power    = account.buying_power    if account else 0.0

        # Snapshot of current broker positions so we know what we're in
        # {symbol: qty}  — positive=long, negative=short, 0/missing=flat
        broker_positions: dict[str, float] = {}
        if account:
            try:
                for pos in get_positions():
                    broker_positions[pos.symbol] = pos.qty
            except Exception:
                pass

        trades_executed = 0
        skipped = 0
        entries: list[str] = []

        for sym in cfg.symbols:
            try:
                df = fetch(sym, period="6mo", interval="1d")
                if df.empty:
                    continue
                r  = engine.analyze(df, sym)
                q  = fetch_quote(sym)
                price = q.get("price", 0.0)
                sig   = r.composite_signal
                conf  = r.composite_confidence
                kelly = r.position_size_pct  # already a percentage

                current_qty = broker_positions.get(sym, 0)
                is_long  = current_qty > 0
                is_short = current_qty < 0
                is_flat  = current_qty == 0

                # ── Decision logic ────────────────────────────────────────
                # Determine the right action and position_intent based on
                # current position state + incoming signal.
                side: str | None     = None
                intent: str | None   = None
                skip_reason: str     = ""
                qty_override: int    = 0   # nonzero → use this qty instead of kelly

                if sig == 0:
                    skip_reason = "signal FLAT"

                elif conf < cfg.min_confidence:
                    skip_reason = f"confidence {conf:.0%} < threshold {cfg.min_confidence:.0%}"

                elif sig == 1:
                    if is_short:
                        # Cover existing short first, then optionally go long next cycle
                        side   = "buy"
                        intent = "buy_to_cover"
                        qty_override = int(abs(current_qty))
                    elif is_flat or is_long:
                        side   = "buy"
                        intent = "buy_to_open"

                elif sig == -1:
                    if not cfg.allow_short:
                        if is_long:
                            # Close the long even when new shorts are disabled
                            side         = "sell"
                            intent       = "sell_to_close"
                            qty_override = int(current_qty)
                        else:
                            skip_reason = "short signals disabled in config"
                    elif is_long:
                        # Signal says short but we're long → close first
                        side         = "sell"
                        intent       = "sell_to_close"
                        qty_override = int(current_qty)
                    elif is_flat:
                        # Check shortability before opening new short
                        ok, reason_str = is_shortable(sym) if account else (False, "no_broker")
                        if not ok:
                            skip_reason = f"not shortable: {reason_str}"
                        else:
                            side   = "sell"
                            intent = "sell_to_open"
                    # If already short — skip (we're already positioned)
                    elif is_short:
                        skip_reason = f"already short {int(abs(current_qty))} shares"

                if side is None:
                    _journal(self._state, sym, "skip", 0, price, 0, sig, conf, kelly, r.regime,
                             skip_reason or "no action", dry_run=cfg.dry_run)
                    skipped += 1
                    continue

                # ── Position sizing ───────────────────────────────────────
                if qty_override > 0:
                    qty = qty_override
                else:
                    effective_kelly = min(kelly, cfg.kelly_cap_pct)
                    dollar_alloc    = portfolio_value * (effective_kelly / 100) if portfolio_value > 0 else 0
                    # For shorts use half the normal size (higher risk)
                    if intent == "sell_to_open":
                        dollar_alloc *= 0.5
                    dollar_alloc = min(dollar_alloc, buying_power * 0.95)
                    qty = int(dollar_alloc / price) if price > 0 else 0

                if qty < 1:
                    reason = f"insufficient buying power: need ${price:.2f} have ${buying_power:.0f}"
                    _journal(self._state, sym, "skip", 0, price, 0, sig, conf, kelly, r.regime,
                             reason, dry_run=cfg.dry_run)
                    skipped += 1
                    continue

                dollar_amount = qty * price
                reason = _trade_reason(sym, side, qty, price, dollar_amount,
                                       min(kelly, cfg.kelly_cap_pct), conf, r.regime,
                                       intent=intent)

                if cfg.dry_run or not account:
                    _journal(self._state, sym, f"{intent or side}", qty, price, dollar_amount,
                             sig, conf, kelly, r.regime, reason, order_id="dry-run", dry_run=True)
                    trades_executed += 1
                    entries.append(f"[DRY] {(intent or side).upper()} {qty} {sym} @ ${price:.2f} = ${dollar_amount:.0f}")
                else:
                    try:
                        result = submit_order(
                            sym, qty, side, "market",
                            time_in_force="day",
                            position_intent=intent or "auto",
                        )
                        if "error" in result:
                            raise RuntimeError(result.get("message", result["error"]))
                        order_id = result.get("id", "")
                        _journal(self._state, sym, f"{intent or side}", qty, price, dollar_amount,
                                 sig, conf, kelly, r.regime, reason, order_id=order_id, dry_run=False)
                        trades_executed += 1
                        buying_power -= dollar_amount
                        # Update local position snapshot
                        if intent == "buy_to_open":
                            broker_positions[sym] = current_qty + qty
                        elif intent == "sell_to_open":
                            broker_positions[sym] = current_qty - qty
                        elif intent in ("sell_to_close", "buy_to_cover"):
                            broker_positions[sym] = 0
                        entries.append(f"{(intent or side).upper()} {qty} {sym} @ ${price:.2f} (order {order_id[:8]})")
                    except Exception as oe:
                        _journal(self._state, sym, "error", qty, price, dollar_amount,
                                 sig, conf, kelly, r.regime, str(oe), dry_run=False)

            except Exception as sym_err:
                _journal(self._state, sym, "error", 0, 0, 0, 0, 0, 0, "", str(sym_err), dry_run=cfg.dry_run)

        self._state.running = False
        self._state.last_run_ts = _now()
        self._state.last_run_summary = (
            f"{trades_executed} trade(s) executed, {skipped} skipped — {', '.join(entries[:3]) or 'nothing actionable'}"
        )
        _save_state(self._state)
        return {"trades_executed": trades_executed, "skipped": skipped, "summary": self._state.last_run_summary, "entries": entries}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _trade_reason(sym: str, side: str, qty: int, price: float, dollar: float, kelly: float,
                  conf: float, regime: str, intent: str | None = None) -> str:
    regime_note  = regime.replace("_", " ") if regime else "unknown regime"
    action_map   = {
        "buy_to_open":   f"Open long {qty} {sym}",
        "buy_to_cover":  f"Cover short {qty} {sym}",
        "sell_to_close": f"Close long {qty} {sym}",
        "sell_to_open":  f"Open short {qty} {sym}",
    }
    action = action_map.get(intent or "", f"{'Buy' if side == 'buy' else 'Sell'} {qty} {sym}")
    return (
        f"{action} at ${price:.2f} (${dollar:.0f}) — "
        f"{kelly:.1f}% Kelly sizing, {conf:.0%} confidence, {regime_note} regime."
    )


def _digest_headline(longs: list, shorts: list) -> str:
    if not longs and not shorts:
        return "No high-conviction signals today — all positions flat."
    parts = []
    if longs:
        syms = ", ".join(r["symbol"] for r in longs[:3])
        parts.append(f"{len(longs)} LONG signal{'s' if len(longs) > 1 else ''}: {syms}")
    if shorts:
        syms = ", ".join(r["symbol"] for r in shorts[:3])
        parts.append(f"{len(shorts)} SHORT signal{'s' if len(shorts) > 1 else ''}: {syms}")
    return ". ".join(parts) + "."


def _journal(state: AgentState, symbol: str, side: str, qty: int, price: float,
             dollar_amount: float, signal: int, confidence: float, kelly_pct: float,
             regime: str, reason: str, order_id: str = "", dry_run: bool = True) -> None:
    state.journal.append(JournalEntry(
        ts=_now(), symbol=symbol, side=side, qty=qty, price=price,
        dollar_amount=dollar_amount, signal=signal, confidence=confidence,
        kelly_pct=kelly_pct, regime=regime, reason=reason,
        order_id=order_id, dry_run=dry_run,
    ))
    # Fire email notification on actual trades (not skips/errors and not dry-run)
    if side in ("buy", "sell") and not dry_run and state.config.notify_email:
        _send_trade_email(state.config.notify_email, symbol, side, qty, price,
                          dollar_amount, confidence, reason)


def _send_trade_email(to: str, symbol: str, side: str, qty: int, price: float,
                      dollar: float, conf: float, reason: str) -> None:
    """
    Sends a plain-text trade notification via SMTP.
    Requires env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
    Falls back silently if not configured.
    """
    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "")
    pw   = os.environ.get("SMTP_PASS", "")
    if not all([host, user, pw, to]):
        return

    subject = f"[QuantTrader] {'BUY' if side == 'buy' else 'SELL'} {qty} {symbol} @ ${price:.2f}"
    body = (
        f"Auto-trade executed by QuantTrader Agent\n"
        f"{'─' * 48}\n\n"
        f"  Symbol      {symbol}\n"
        f"  Side        {side.upper()}\n"
        f"  Quantity    {qty} shares\n"
        f"  Price       ${price:.2f}\n"
        f"  Total       ${dollar:,.2f}\n"
        f"  Confidence  {conf:.0%}\n\n"
        f"  Reason: {reason}\n\n"
        f"{'─' * 48}\n"
        f"Sent by QuantTrader Auto-Trade Agent · {_now()}\n"
        f"To disable: turn off notifications in the Strategy Config tab.\n"
    )

    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"]    = user
        msg["To"]      = to
        with smtplib.SMTP(host, port, timeout=10) as s:
            s.starttls()
            s.login(user, pw)
            s.sendmail(user, [to], msg.as_string())
    except Exception:
        pass  # never let email failure break the agent loop


# ── Engine singleton (reuse server's warm engine if available) ────────────────

_engine_instance = None
_engine_lock = threading.Lock()

def _get_engine():
    global _engine_instance
    # If server.py already has a warm engine, try to reuse it
    try:
        import api.server as _srv
        if hasattr(_srv, "_engine") and _srv._engine is not None:
            return _srv._engine
    except Exception:
        pass
    with _engine_lock:
        if _engine_instance is None:
            from api.quant.engine import QuantEngine
            _engine_instance = QuantEngine()
    return _engine_instance
