"""
circuit_breaker.py — Account-level circuit breaker.

Monitors actual Alpaca account equity against the prior-close baseline.
When equity drops more than `threshold_pct`% from last_equity, all agents
halt new entries and an alert email is fired exactly once.

Design:
  - State is persisted to a single JSON sidecar so the flag survives process
    restarts and is shared across all threads.
  - `check_and_trip()` is called by both the swing agent and the intraday agent
    before entering any position. It is a no-op if the breaker is already tripped
    or if Alpaca credentials are missing.
  - `reset()` clears the flag (callable from the management API).

Thread safety: a module-level lock protects all reads/writes to the state file.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone

log = logging.getLogger("circuit_breaker")

# ── State file path ───────────────────────────────────────────────────────────

_STATE_PATH = (
    "/tmp/circuit_breaker.json"
    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    else os.path.join(os.path.dirname(__file__), "circuit_breaker.json")
)

_lock = threading.Lock()


# ── Default config ─────────────────────────────────────────────────────────────

DEFAULT_THRESHOLD_PCT = 5.0   # halt if equity drops >5% from prior close
DEFAULT_NOTIFY_EMAIL  = ""


# ── State I/O ─────────────────────────────────────────────────────────────────

def _default_state() -> dict:
    return {
        "tripped":        False,
        "tripped_at":     "",
        "equity_at_trip": 0.0,
        "last_equity":    0.0,
        "drop_pct":       0.0,
        "threshold_pct":  DEFAULT_THRESHOLD_PCT,
        "notify_email":   DEFAULT_NOTIFY_EMAIL,
        "alert_sent":     False,
    }


def _load() -> dict:
    if not os.path.exists(_STATE_PATH):
        return _default_state()
    try:
        with open(_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return _default_state()


def _save(state: dict) -> None:
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, _STATE_PATH)


# ── Public API ────────────────────────────────────────────────────────────────

def get_status() -> dict:
    """Return current circuit breaker state (safe to call from any thread)."""
    with _lock:
        s = _load()
    return {
        "tripped":        s.get("tripped", False),
        "tripped_at":     s.get("tripped_at", ""),
        "equity_at_trip": s.get("equity_at_trip", 0.0),
        "last_equity":    s.get("last_equity", 0.0),
        "drop_pct":       round(s.get("drop_pct", 0.0), 2),
        "threshold_pct":  s.get("threshold_pct", DEFAULT_THRESHOLD_PCT),
        "notify_email":   s.get("notify_email", ""),
        "alert_sent":     s.get("alert_sent", False),
    }


def configure(threshold_pct: float | None = None, notify_email: str | None = None) -> dict:
    """Update breaker config. Does not clear a tripped state."""
    with _lock:
        s = _load()
        if threshold_pct is not None:
            s["threshold_pct"] = max(0.5, min(float(threshold_pct), 50.0))
        if notify_email is not None:
            s["notify_email"] = str(notify_email).strip()
        _save(s)
    return get_status()


def reset() -> dict:
    """Manually clear a tripped breaker (e.g. after reviewing the situation)."""
    with _lock:
        s = _load()
        s["tripped"]        = False
        s["tripped_at"]     = ""
        s["equity_at_trip"] = 0.0
        s["drop_pct"]       = 0.0
        s["alert_sent"]     = False
        _save(s)
    log.warning("Circuit breaker manually reset")
    return get_status()


def is_tripped() -> bool:
    """Fast check — used by agents before entering a position."""
    with _lock:
        return _load().get("tripped", False)


def check_and_trip() -> bool:
    """
    Query Alpaca account equity; trip the breaker if equity dropped more
    than threshold_pct from last_equity (prior close).

    Returns True if the breaker is now tripped (either just now or previously).
    Returns False if all clear.

    This function is safe to call frequently — it does nothing if:
      - already tripped
      - Alpaca credentials are missing
      - equity or last_equity is zero
    """
    with _lock:
        s = _load()

    if s.get("tripped", False):
        return True

    try:
        from api.quant.broker import get_account
        acct = get_account()
        if acct is None:
            return False

        equity      = acct.equity
        last_equity = acct.last_equity

        if last_equity <= 0 or equity <= 0:
            return False

        drop_pct = (last_equity - equity) / last_equity * 100

        with _lock:
            s = _load()
            # Update the live equity snapshot regardless
            s["last_equity"] = round(last_equity, 2)
            s["drop_pct"]    = round(drop_pct, 2)

            threshold = s.get("threshold_pct", DEFAULT_THRESHOLD_PCT)

            if drop_pct >= threshold:
                s["tripped"]        = True
                s["tripped_at"]     = datetime.now(timezone.utc).isoformat()
                s["equity_at_trip"] = round(equity, 2)
                _save(s)
                log.critical(
                    "CIRCUIT BREAKER TRIPPED: equity $%.2f, last_equity $%.2f, drop %.2f%% >= threshold %.1f%%",
                    equity, last_equity, drop_pct, threshold,
                )
                # Fire alert email in daemon thread (never blocks)
                to = s.get("notify_email", "").strip()
                if to and not s.get("alert_sent", False):
                    threading.Thread(
                        target=_send_circuit_alert,
                        args=(to, equity, last_equity, drop_pct, threshold),
                        daemon=True,
                    ).start()
                    # Mark sent synchronously so we don't fire twice
                    s["alert_sent"] = True
                    _save(s)
                return True
            else:
                _save(s)
                return False

    except Exception as e:
        log.warning("circuit_breaker.check_and_trip error: %s", e)
        return False


# ── Alert email ───────────────────────────────────────────────────────────────

def _send_circuit_alert(
    to: str, equity: float, last_equity: float, drop_pct: float, threshold: float
) -> None:
    subject = f"[QuantTrader] CIRCUIT BREAKER TRIPPED — {drop_pct:.1f}% account loss"
    body = (
        f"CIRCUIT BREAKER TRIPPED\n"
        f"{'=' * 40}\n\n"
        f"Your account has dropped {drop_pct:.2f}% from the prior close,\n"
        f"exceeding the configured threshold of {threshold:.1f}%.\n\n"
        f"  Prior close equity : ${last_equity:,.2f}\n"
        f"  Current equity     : ${equity:,.2f}\n"
        f"  Loss today         : ${last_equity - equity:,.2f} ({drop_pct:.2f}%)\n\n"
        f"ALL new position entries have been halted for both agents.\n"
        f"Open positions are NOT force-closed — manage them manually.\n\n"
        f"To reset the breaker after reviewing:\n"
        f"  POST /api/circuit-breaker/reset\n\n"
        f"-- QuantTrader"
    )

    # Try Resend HTTP API first
    resend_key  = os.environ.get("RESEND_API_KEY", "").strip()
    notify_from = os.environ.get("NOTIFY_FROM", "alerts@quanttrader.app").strip()
    if resend_key:
        try:
            import urllib.request
            payload = json.dumps({
                "from": notify_from, "to": [to],
                "subject": subject, "text": body,
            }).encode()
            req = urllib.request.Request(
                "https://api.resend.com/emails",
                data=payload,
                headers={"Authorization": f"Bearer {resend_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10):
                pass
            log.info("Circuit breaker alert sent via Resend to %s", to)
            return
        except Exception as e:
            log.warning("Resend circuit alert failed (%s) — trying SMTP", e)

    # SMTP fallback
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_pass = os.environ.get("SMTP_PASS", "").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    if smtp_host and smtp_user:
        try:
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(body)
            msg["Subject"] = subject
            msg["From"]    = smtp_user
            msg["To"]      = to
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                s.starttls()
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_user, [to], msg.as_string())
            log.info("Circuit breaker alert sent via SMTP to %s", to)
        except Exception as e:
            log.warning("SMTP circuit alert failed: %s", e)
