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

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except ImportError:
    # Python < 3.9 fallback — UTC offset −5 / −4 (approximate; correct for scheduling)
    import datetime as _dt
    _ET = timezone(_dt.timedelta(hours=-5))

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
    notify_email: str      = ""             # email for trade alerts and digest
    daily_loss_cap_pct: float = 2.0         # halt agent for the day if P&L drops below -X% of portfolio
    max_concentration_pct: float = 60.0    # skip new entries if open positions already exceed X% of portfolio
    horizon: str = "swing"                  # analysis horizon: day | swing | month | quarter | year


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
    # Outcome tracking — resolved ~5 trading days after entry
    outcome: str = ""               # "win" | "loss" | "neutral" | "" (pending)
    outcome_price: float = 0.0      # price N days after signal
    outcome_return_pct: float = 0.0 # (outcome_price - price) / price * 100 * signal_dir


@dataclass
class AgentState:
    config: AgentConfig = field(default_factory=AgentConfig)
    journal: list[JournalEntry] = field(default_factory=list)
    last_run_ts: str = ""
    last_run_summary: str = ""
    running: bool = False
    error: str = ""
    daily_loss_halted: bool = False         # True when daily loss cap has been hit
    daily_loss_halted_date: str = ""        # ISO date when halt was set
    last_digest_date: str = ""              # ISO date of last sent morning digest
    paper_equity_start: float = 0.0         # account equity when paper trading began
    paper_trades_pnl: float = 0.0          # running sum of resolved paper trade P&L


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
            daily_loss_halted=raw.get("daily_loss_halted", False),
            daily_loss_halted_date=raw.get("daily_loss_halted_date", ""),
            last_digest_date=raw.get("last_digest_date", ""),
            paper_equity_start=float(raw.get("paper_equity_start", 0.0)),
            paper_trades_pnl=float(raw.get("paper_trades_pnl", 0.0)),
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
        "daily_loss_halted": state.daily_loss_halted,
        "daily_loss_halted_date": state.daily_loss_halted_date,
        "last_digest_date": state.last_digest_date,
        "paper_equity_start": state.paper_equity_start,
        "paper_trades_pnl": state.paper_trades_pnl,
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
        paper_count = sum(
            1 for e in s.journal
            if e.dry_run and e.side not in ("skip", "error") and e.outcome != ""
        )
        return {
            "running":                s.running,
            "enabled":                s.config.enabled,
            "last_run_ts":            s.last_run_ts,
            "last_run_summary":       s.last_run_summary,
            "journal_count":          len(s.journal),
            "error":                  s.error,
            "dry_run":                s.config.dry_run,
            "daily_loss_halted":      s.daily_loss_halted,
            "daily_loss_halted_date": s.daily_loss_halted_date,
            "daily_loss_cap_pct":     s.config.daily_loss_cap_pct,
            "last_digest_date":       s.last_digest_date,
            "paper_equity_start":     s.paper_equity_start,
            "paper_trades_pnl":       round(s.paper_trades_pnl, 2),
            "paper_trades_count":     paper_count,
        }

    def get_journal(self, limit: int = 50) -> list[dict]:
        return [asdict(e) for e in reversed(self._state.journal[-limit:])]

    def get_debrief(self, trade_id: str) -> dict:
        """
        Post-trade debrief for a single journal entry identified by its timestamp
        (trade_id = entry.ts, URL-encoded).  Returns plain-English analysis of
        what happened vs. what was expected, which signals fired, and whether they
        were right.
        """
        # Locate the entry
        entry = next((e for e in self._state.journal if e.ts == trade_id), None)
        if entry is None:
            return {"error": f"Trade '{trade_id}' not found in journal"}

        sig_word   = "LONG" if entry.signal == 1 else "SHORT" if entry.signal == -1 else "FLAT"
        side_word  = entry.side.replace("_", " ")
        pending    = entry.outcome == ""
        won        = entry.outcome == "win"
        lost       = entry.outcome == "loss"
        neutral    = entry.outcome == "neutral"

        # ── What happened ────────────────────────────────────────────────────
        if pending:
            what_happened = (
                f"This {sig_word} signal on {entry.symbol} was placed on {entry.ts[:10]} "
                f"at ${entry.price:.2f} and is still within the 5-day evaluation window. "
                f"Outcome will be resolved once enough trading days have passed."
            )
        elif won:
            ret = entry.outcome_return_pct
            what_happened = (
                f"The {sig_word} on {entry.symbol} worked. Entry at ${entry.price:.2f}, "
                f"outcome price ${entry.outcome_price:.2f} — a {ret:+.1f}% directed gain. "
                f"The signal fired correctly."
            )
        elif lost:
            ret = entry.outcome_return_pct
            what_happened = (
                f"The {sig_word} on {entry.symbol} did not work. Entry at ${entry.price:.2f}, "
                f"outcome price ${entry.outcome_price:.2f} — a {ret:+.1f}% directed loss. "
                f"The market moved against the signal within 5 trading days."
            )
        else:  # neutral
            what_happened = (
                f"The {sig_word} on {entry.symbol} was inconclusive. Entry at ${entry.price:.2f}, "
                f"outcome price ${entry.outcome_price:.2f} — nearly flat ({entry.outcome_return_pct:+.1f}%). "
                f"Neither confirmed nor refuted the signal."
            )

        # ── What was expected (regime + confidence context) ──────────────────
        conf_pct = round(entry.confidence * 100, 1)
        regime_note = (
            f"The model ran in a '{entry.regime}' regime with {conf_pct}% confidence."
            if entry.regime and entry.regime != "unknown"
            else f"Model confidence was {conf_pct}%."
        )

        if entry.confidence >= 0.80:
            conf_interpretation = "High confidence — the model strongly favoured this direction."
        elif entry.confidence >= 0.65:
            conf_interpretation = "Moderate confidence — a reasonable but not definitive signal."
        else:
            conf_interpretation = "Low confidence — the model was uncertain; this was a marginal call."

        what_was_expected = f"{regime_note} {conf_interpretation}"

        # ── Which signals fired ──────────────────────────────────────────────
        reason_text = entry.reason or "No reason recorded."

        # Parse sub-signal keywords from the reason string
        _signal_map = {
            "rsi":      "RSI (momentum oscillator)",
            "macd":     "MACD (trend momentum)",
            "bollinger": "Bollinger Bands (volatility breakout)",
            "volume":   "Volume surge",
            "vwap":     "VWAP (intraday fair value)",
            "regime":   "Regime filter",
            "kelly":    "Kelly sizing",
        }
        fired = [label for kw, label in _signal_map.items() if kw.lower() in reason_text.lower()]
        signals_fired = ", ".join(fired) if fired else "signal details not recorded"

        # ── Were the signals right? ──────────────────────────────────────────
        if pending:
            signals_verdict = "Cannot determine yet — outcome is still pending."
        elif won:
            signals_verdict = (
                f"Yes — {signals_fired} correctly identified the direction. "
                f"The {entry.outcome_return_pct:+.1f}% gain confirms the thesis."
            )
        elif lost:
            signals_verdict = (
                f"No — {signals_fired} fired but price moved against the position. "
                f"Review whether {entry.regime} regime conditions were favourable at entry time."
            )
        else:
            signals_verdict = (
                f"{signals_fired} fired but the result was inconclusive — "
                f"price barely moved in either direction."
            )

        # ── One-sentence plain-English summary ───────────────────────────────
        if pending:
            one_liner = f"The agent went {sig_word} on {entry.symbol} at ${entry.price:.2f} — still waiting for the outcome."
        elif won:
            one_liner = (
                f"The agent correctly went {sig_word} on {entry.symbol} at ${entry.price:.2f} "
                f"and made {entry.outcome_return_pct:+.1f}% in 5 days."
            )
        elif lost:
            one_liner = (
                f"The agent went {sig_word} on {entry.symbol} at ${entry.price:.2f} "
                f"but lost {abs(entry.outcome_return_pct):.1f}% — the signal did not play out."
            )
        else:
            one_liner = (
                f"The agent went {sig_word} on {entry.symbol} at ${entry.price:.2f} "
                f"and the trade ended roughly flat."
            )

        return {
            "trade_id":          trade_id,
            "symbol":            entry.symbol,
            "side":              side_word,
            "signal":            sig_word,
            "entry_price":       entry.price,
            "outcome_price":     entry.outcome_price,
            "outcome":           entry.outcome or "pending",
            "return_pct":        round(entry.outcome_return_pct, 2),
            "confidence":        round(entry.confidence, 3),
            "regime":            entry.regime,
            "dry_run":           entry.dry_run,
            "ts":                entry.ts,
            # Debrief narrative
            "what_happened":     what_happened,
            "what_was_expected": what_was_expected,
            "signals_fired":     signals_fired,
            "signals_verdict":   signals_verdict,
            "one_liner":         one_liner,
        }

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
                if df.empty or len(df) < 50:
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

            # ── Morning digest at 8:30 AM ET (runs regardless of enabled flag) ──
            self._maybe_send_morning_digest()

            # ── Resolve outcomes for journal entries that are ≥5 trading days old ──
            try:
                self._resolve_outcomes()
            except Exception:
                pass

            if cfg.enabled:
                try:
                    self._execute_cycle()
                except Exception as e:
                    self._state.error = str(e)
                    self._state.running = False
                    _save_state(self._state)
            interval_s = self._state.config.poll_interval_min * 60
            self._stop_event.wait(timeout=interval_s)

    def get_track_record(self) -> dict:
        """Aggregate live signal outcomes for the track-record endpoint."""
        resolved = [
            e for e in self._state.journal
            if e.outcome in ("win", "loss", "neutral")
            and e.side in ("buy_to_open", "sell_to_open", "buy", "sell")
        ]
        if not resolved:
            return {
                "total": 0, "wins": 0, "losses": 0, "neutrals": 0,
                "win_rate": 0, "avg_return_pct": 0.0, "entries": [],
            }
        wins    = [e for e in resolved if e.outcome == "win"]
        losses  = [e for e in resolved if e.outcome == "loss"]
        neutral = [e for e in resolved if e.outcome == "neutral"]
        avg_ret = sum(e.outcome_return_pct for e in resolved) / len(resolved)
        win_rate = round(len(wins) / max(len(wins) + len(losses), 1) * 100, 1)
        return {
            "total":          len(resolved),
            "wins":           len(wins),
            "losses":         len(losses),
            "neutrals":       len(neutral),
            "win_rate":       win_rate,
            "avg_return_pct": round(avg_ret, 2),
            "entries": [
                {
                    "ts":          e.ts,
                    "symbol":      e.symbol,
                    "side":        e.side,
                    "signal":      e.signal,
                    "price":       e.price,
                    "outcome":     e.outcome,
                    "outcome_price": e.outcome_price,
                    "return_pct":  round(e.outcome_return_pct, 2),
                    "confidence":  e.confidence,
                    "regime":      e.regime,
                }
                for e in reversed(resolved[-50:])
            ],
        }

    def _resolve_outcomes(self) -> None:
        """For journal entries ≥5 days old with no outcome, fetch current price and resolve."""
        from api.quant.data import fetch_quote
        OUTCOME_DAYS = 5        # trading days to measure forward return
        CALENDAR_DAYS = 8       # calendar days buffer (≈5 trading days + weekends)
        WIN_THRESHOLD = 0.5     # % — above this for longs counts as win
        now = datetime.now(timezone.utc)
        changed = False
        for entry in self._state.journal:
            # Only resolve actionable, unresolved entries
            if entry.outcome != "":
                continue
            if entry.side not in ("buy_to_open", "sell_to_open", "buy", "sell"):
                continue
            if entry.signal == 0 or entry.price <= 0:
                continue
            try:
                entry_dt = datetime.strptime(entry.ts, "%Y-%m-%d %H:%M:%S UTC").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            age_days = (now - entry_dt).days
            if age_days < CALENDAR_DAYS:
                continue  # too soon — give the trade time to play out
            try:
                q = fetch_quote(entry.symbol)
                current_price = q.get("price", 0.0)
                if current_price <= 0:
                    continue
                raw_ret = (current_price - entry.price) / entry.price * 100
                # Direction-adjust: long signals benefit from price up; short from price down
                directed_ret = raw_ret if entry.signal == 1 else -raw_ret
                entry.outcome_price = round(current_price, 4)
                entry.outcome_return_pct = round(directed_ret, 2)
                if directed_ret > WIN_THRESHOLD:
                    entry.outcome = "win"
                elif directed_ret < -WIN_THRESHOLD:
                    entry.outcome = "loss"
                else:
                    entry.outcome = "neutral"
                changed = True
                # Accumulate paper P&L
                if entry.dry_run and entry.dollar_amount > 0:
                    trade_pnl = entry.dollar_amount * (directed_ret / 100)
                    self._state.paper_trades_pnl += trade_pnl
                # Email outcome notification
                notify = self._state.config.notify_email
                if notify:
                    result_word = "+" if entry.outcome == "win" else ("-" if entry.outcome == "loss" else "±")
                    subject = (
                        f"[QuantTrader] Trade result: {entry.symbol} "
                        f"{result_word}{abs(directed_ret):.1f}%"
                    )
                    body = (
                        f"Trade outcome resolved for {entry.symbol}\n"
                        f"{'─' * 48}\n\n"
                        f"  Signal:    {'LONG' if entry.signal == 1 else 'SHORT'}\n"
                        f"  Entry:     ${entry.price:.2f} on {entry.ts[:10]}\n"
                        f"  Exit ref:  ${current_price:.2f} ({age_days} calendar days later)\n"
                        f"  Return:    {directed_ret:+.2f}%\n"
                        f"  Outcome:   {entry.outcome.upper()}\n\n"
                        f"  {entry.reason}\n\n"
                        f"{'─' * 48}\n"
                        f"Sent by QuantTrader Agent · {_now()}\n"
                    )
                    threading.Thread(
                        target=_send_email, args=(notify, subject, body), daemon=True
                    ).start()
            except Exception:
                pass  # non-critical — will retry next loop
        if changed:
            _save_state(self._state)

    def _maybe_send_morning_digest(self) -> None:
        """Send the morning digest email once per day at 8:30 AM ET if an email is configured."""
        to = (
            os.environ.get("DIGEST_EMAIL", "").strip()
            or self._state.config.notify_email.strip()
        )
        if not to:
            return

        now_et = datetime.now(_ET)
        today = now_et.date().isoformat()

        # Already sent today
        if self._state.last_digest_date == today:
            return

        # Only fire between 08:30 and 08:59 ET
        if not (now_et.hour == 8 and now_et.minute >= 30):
            return

        try:
            digest = self.get_digest()
            _send_digest_email(to, digest)
            self._state.last_digest_date = today
            _save_state(self._state)
        except Exception:
            pass  # never let digest failure break the loop

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

        # ── Daily loss cap gate ───────────────────────────────────────────────
        today = datetime.now(timezone.utc).date().isoformat()
        # Reset halt at the start of a new calendar day
        if self._state.daily_loss_halted and self._state.daily_loss_halted_date != today:
            self._state.daily_loss_halted = False
            self._state.daily_loss_halted_date = ""
            _save_state(self._state)

        if not self._state.daily_loss_halted and cfg.daily_loss_cap_pct > 0 and account:
            try:
                daily_pnl = float(getattr(account, "equity", portfolio_value) or portfolio_value) - float(getattr(account, "last_equity", portfolio_value) or portfolio_value)
                daily_pnl_pct = (daily_pnl / portfolio_value * 100) if portfolio_value > 0 else 0
                if daily_pnl_pct <= -abs(cfg.daily_loss_cap_pct):
                    self._state.daily_loss_halted = True
                    self._state.daily_loss_halted_date = today
                    halt_msg = f"Daily loss cap hit: P&L {daily_pnl_pct:.2f}% ≤ -{cfg.daily_loss_cap_pct:.1f}%. Agent halted for today."
                    self._state.last_run_summary = halt_msg
                    self._state.running = False
                    _save_state(self._state)
                    if cfg.notify_email:
                        threading.Thread(
                            target=_send_email,
                            args=(cfg.notify_email,
                                  "[QuantTrader] ⚠️ Agent halted — daily loss cap hit",
                                  f"QuantTrader Agent has been halted for today.\n\n"
                                  f"  Reason: {halt_msg}\n\n"
                                  f"  Date: {today}\n"
                                  f"  Next check-in: tomorrow at market open.\n\n"
                                  f"To reset manually, open the Agent panel and click Reset.\n"
                                  f"Sent by QuantTrader Agent · {_now()}\n"),
                            daemon=True,
                        ).start()
                    return {"trades_executed": 0, "skipped": 0, "summary": halt_msg, "entries": []}
            except Exception:
                pass  # broker attribute access can vary; never block on this

        if self._state.daily_loss_halted:
            halt_msg = f"Agent halted: daily loss cap hit on {self._state.daily_loss_halted_date}. Resumes tomorrow."
            self._state.running = False
            _save_state(self._state)
            return {"trades_executed": 0, "skipped": 0, "summary": halt_msg, "entries": []}

        # ── Account-level circuit breaker ─────────────────────────────────────
        try:
            from api.quant.circuit_breaker import check_and_trip
            if check_and_trip():
                halt_msg = (
                    "CIRCUIT BREAKER: account equity has dropped beyond the configured threshold. "
                    "All new entries halted. Reset via /api/circuit-breaker/reset."
                )
                self._state.last_run_summary = halt_msg
                self._state.running = False
                _save_state(self._state)
                return {"trades_executed": 0, "skipped": 0, "summary": halt_msg, "entries": []}
        except Exception:
            pass  # never let breaker check block the cycle

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

        # Longer horizons need more price history for reliable regime detection
        _horizon_period = "1y" if cfg.horizon in ("quarter", "year") else "6mo"

        for sym in cfg.symbols:
            try:
                df = fetch(sym, period=_horizon_period, interval="1d")
                if df.empty or len(df) < 50:
                    continue
                r  = engine.analyze(df, sym, horizon=cfg.horizon)
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

                # ── Concentration cap (new entries only) ──────────────────
                # Don't apply to closes/covers — those reduce exposure, not add it.
                if intent in ("buy_to_open", "sell_to_open") and cfg.max_concentration_pct > 0 and portfolio_value > 0:
                    open_market_value = sum(
                        abs(qty_) * (broker_positions.get(s_, 0) and price or 0)
                        for s_, qty_ in broker_positions.items()
                        if qty_ != 0
                    )
                    # Simpler: use broker positions market value directly when available
                    try:
                        from api.quant.broker import get_positions
                        positions_list = get_positions() if account else []
                        open_mv = sum(abs(p.market_value) for p in positions_list)
                    except Exception:
                        open_mv = open_market_value
                    concentration_pct = (open_mv / portfolio_value) * 100
                    if concentration_pct >= cfg.max_concentration_pct:
                        reason_conc = (
                            f"concentration cap: open positions are {concentration_pct:.1f}% "
                            f"of portfolio (limit {cfg.max_concentration_pct:.0f}%). "
                            f"Close an existing position before opening a new one."
                        )
                        _journal(self._state, sym, "skip", 0, price, 0, sig, conf, kelly, r.regime,
                                 reason_conc, dry_run=cfg.dry_run)
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
                                       intent=intent,
                                       signals=r.signals,
                                       indicators=r.indicators)

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
                  conf: float, regime: str, intent: str | None = None,
                  signals: list | None = None, indicators: dict | None = None) -> str:
    regime_plain = {
        "trending_up":    "uptrend",
        "trending_down":  "downtrend",
        "mean_reverting": "range-bound market",
        "volatile":       "high-volatility market",
        "quiet":          "low-volatility (quiet) market",
    }.get(regime, regime.replace("_", " ") if regime else "unknown conditions")

    action_map = {
        "buy_to_open":   f"Opened long {qty} {sym}",
        "buy_to_cover":  f"Covered short {qty} {sym}",
        "sell_to_close": f"Closed long {qty} {sym}",
        "sell_to_open":  f"Opened short {qty} {sym}",
    }
    action = action_map.get(intent or "", f"{'Bought' if side == 'buy' else 'Sold'} {qty} {sym}")

    # Sub-signal agreement summary
    bullish = bearish = 0
    stop_price = 0.0
    if signals:
        for s in signals:
            if getattr(s, "direction", 0) == 1:
                bullish += 1
            elif getattr(s, "direction", 0) == -1:
                bearish += 1
            if stop_price == 0.0 and getattr(s, "stop_loss", 0):
                stop_price = s.stop_loss
    total_subs = bullish + bearish
    sub_note = ""
    if total_subs > 0:
        if intent in ("buy_to_open", "buy_to_cover"):
            sub_note = f" {bullish}/{total_subs} sub-models bullish."
        else:
            sub_note = f" {bearish}/{total_subs} sub-models bearish."

    # RSI note
    rsi_note = ""
    if indicators:
        rsi = indicators.get("rsi_14", 0)
        if rsi:
            if intent in ("buy_to_open",) and rsi < 45:
                rsi_note = f" RSI {rsi:.0f} (oversold momentum)."
            elif intent in ("sell_to_open",) and rsi > 55:
                rsi_note = f" RSI {rsi:.0f} (overbought momentum)."
            else:
                rsi_note = f" RSI {rsi:.0f}."

    # Stop note
    stop_note = f" Stop at ${stop_price:.2f}." if stop_price > 0 else ""

    return (
        f"{action} at ${price:.2f} (${dollar:.0f}). "
        f"{conf:.0%} confidence, {kelly:.1f}% Kelly, {regime_plain}."
        f"{sub_note}{rsi_note}{stop_note}"
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
    if side not in ("skip", "error") and not dry_run and state.config.notify_email:
        to = state.config.notify_email
        threading.Thread(
            target=_send_trade_email,
            args=(to, symbol, side, qty, price, dollar_amount, confidence, reason),
            daemon=True,
        ).start()


def _send_email(to: str, subject: str, body: str) -> None:
    """
    Fire-and-forget email with dual transport: Resend HTTP API → SMTP fallback.
    Never raises. Call from a daemon thread so it never blocks the agent loop.
    """
    if not to:
        return

    resend_key  = os.environ.get("RESEND_API_KEY", "").strip()
    notify_from = os.environ.get("NOTIFY_FROM", "alerts@quanttrader.app").strip()

    if resend_key:
        try:
            import urllib.request as _urllib_req
            payload = json.dumps({
                "from": notify_from, "to": [to],
                "subject": subject, "text": body,
            }).encode()
            req = _urllib_req.Request(
                "https://api.resend.com/emails",
                data=payload,
                headers={"Authorization": f"Bearer {resend_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with _urllib_req.urlopen(req, timeout=10):
                pass
            return
        except Exception:
            pass  # fall through to SMTP

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
    except Exception:
        pass  # never let email failure break the agent loop


def _send_trade_email(to: str, symbol: str, side: str, qty: int, price: float,
                      dollar: float, conf: float, reason: str) -> None:
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
    _send_email(to, subject, body)


def _send_digest_email(to: str, digest: dict) -> None:
    _now_et = datetime.now(_ET)
    date_str = _now_et.strftime("%A, %B ") + str(_now_et.day)
    headline = digest.get("headline", "")
    results  = digest.get("results", [])
    longs    = [r for r in results if r.get("signal") == 1  and r.get("actionable")]
    shorts   = [r for r in results if r.get("signal") == -1 and r.get("actionable")]
    flat     = [r for r in results if not r.get("actionable") and not r.get("error")]

    def row(r: dict) -> str:
        sym   = r.get("symbol", "")
        price = r.get("price", 0)
        chg   = r.get("change_pct", 0)
        conf  = r.get("confidence", 0)
        kelly = r.get("kelly_pct", 0)
        regime = r.get("regime", "").replace("_", " ")
        chg_str = f"+{chg:.2f}%" if chg >= 0 else f"{chg:.2f}%"
        return (
            f"  {sym:<8}  ${price:<8.2f}  {chg_str:<8}  "
            f"Conf {conf:.0%}  Kelly {kelly:.1f}%  [{regime}]"
        )

    sections: list[str] = []
    if longs:
        sections.append("── LONG SIGNALS (" + str(len(longs)) + ")\n" + "\n".join(row(r) for r in longs))
    if shorts:
        sections.append("── SHORT SIGNALS (" + str(len(shorts)) + ")\n" + "\n".join(row(r) for r in shorts))
    if flat:
        syms = ", ".join(r.get("symbol", "") for r in flat[:8])
        sections.append(f"── NO SIGNAL  {syms}")

    body = (
        f"QuantTrader Morning Digest — {date_str}\n"
        f"{'═' * 56}\n\n"
        f"{headline}\n\n"
        + "\n\n".join(sections)
        + f"\n\n{'─' * 56}\n"
        f"Scanned {digest.get('symbols_scanned', 0)} symbols · "
        f"{digest.get('actionable_longs', 0)} long · "
        f"{digest.get('actionable_shorts', 0)} short\n"
        f"Generated {digest.get('generated_at', _now())}\n\n"
        f"Manage settings in QuantTrader → Agent → Config\n"
        f"To unsubscribe, clear notify_email in agent config.\n"
    )

    subject = f"[QuantTrader] {date_str} Digest — {headline[:60]}"
    _send_email(to, subject, body)


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
