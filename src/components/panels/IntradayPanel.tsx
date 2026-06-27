"use client";

/**
 * IntradayPanel — single-stock intraday execution agent UI.
 *
 * User sets: symbol, direction (LONG/SHORT), account size, risk config.
 * Algorithm handles: entry timing, stop monitoring, scale-out, EOD close.
 *
 * Polls /api/intraday/status every 15 s while session is active.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { TrendingUp, TrendingDown, Play, Square, RefreshCw, AlertTriangle, CheckCircle, Clock, Activity } from "lucide-react";
import { useTrader } from "@/store/trader";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

const C = {
  green:  "#1A6B4A",
  red:    "#C41E3A",
  amber:  "#8B6914",
  blue:   "#0B1F3A",
  text:   "#1A1A1A",
  muted:  "#5A5248",
  faint:  "#8A8078",
};

// ── API types ─────────────────────────────────────────────────────────────────

interface TradeRecord {
  ts:            string;
  action:        string;
  qty:           number;
  price:         number;
  dollar_amount: number;
  stop_price:    number;
  target_price:  number;
  order_id:      string;
  dry_run:       boolean;
  reason:        string;
  pnl_pct:       number;
}

interface IntradayContext {
  price?:        number;
  vwap?:         number;
  above_vwap?:   boolean;
  atr?:          number;
  rsi?:          number;
  orb_high?:     number;
  orb_low?:      number;
  bar_count?:    number;
  regime?:       string;  // "trending" | "volatile" | "mixed"
  regime_ratio?: number;
}

interface IntradayStatus {
  state:               string;
  symbol:              string;
  direction:           number;
  direction_word:      string;
  trades_today:        number;
  max_trades:          number;
  current_qty:         number;
  avg_entry_price:     number;
  current_price:       number;
  unrealized_pnl:      number;
  unrealized_pct:      number;
  realized_pnl:        number;
  max_drawdown:        number;
  stop_price:          number;
  target_price:        number;
  last_signal_reason:  string;
  last_update:         string;
  error:               string;
  trades:              TradeRecord[];
  context:             IntradayContext;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPnl(n: number) {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fmt$(Math.abs(n))}`;
}

const STATE_COLOR: Record<string, string> = {
  idle:        C.faint,
  waiting:     C.amber,
  in_position: C.green,
  scaling_out: C.amber,
  closed:      C.blue,
  error:       C.red,
};

const STATE_LABEL: Record<string, string> = {
  idle:        "Not Started",
  waiting:     "Waiting for Signal",
  in_position: "In Position",
  scaling_out: "Scaling Out (3:15 PM)",
  closed:      "Session Closed",
  error:       "Error",
};

const ACTION_COLOR: Record<string, string> = {
  entry_long:    C.green,
  entry_short:   C.red,
  stop_exit:     C.red,
  target_exit:   C.green,
  scale_out:     C.amber,
  eod_close:     C.blue,
  reversal_exit: C.amber,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({ label, value, color = C.text, mono = true }: {
  label: string; value: string; color?: string; mono?: boolean;
}) {
  return (
    <div style={{ padding: "8px 10px", background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px" }}>
        {label}
      </div>
      <div style={{ fontFamily: mono ? FONT_MONO : FONT_BODY, fontSize: "14px", fontWeight: 800, color }}>
        {value}
      </div>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const color = STATE_COLOR[state] ?? C.faint;
  const label = STATE_LABEL[state] ?? state;
  return (
    <span style={{
      fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700,
      letterSpacing: "0.12em", textTransform: "uppercase",
      padding: "3px 10px",
      color, border: `1px solid ${color}55`,
      background: `${color}0D`,
    }}>
      {label}
    </span>
  );
}

function ContextBar({ ctx }: { ctx: IntradayContext }) {
  if (!ctx || !ctx.price) return null;
  const regimeColor = ctx.regime === "volatile" ? C.red : ctx.regime === "trending" ? C.green : C.faint;
  const regimeLabel = ctx.regime === "volatile"
    ? `VOLATILE (${ctx.regime_ratio?.toFixed(1)}×)`
    : ctx.regime === "trending"
    ? `TRENDING (${ctx.regime_ratio?.toFixed(1)}×)`
    : "MIXED";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px",
    }}>
      <StatBox label="Price"    value={`$${ctx.price?.toFixed(2) ?? "—"}`} />
      <StatBox label="VWAP"     value={`$${ctx.vwap?.toFixed(2) ?? "—"}`}
        color={ctx.above_vwap ? C.green : C.red} />
      <StatBox label="RSI(9)"   value={ctx.rsi?.toFixed(1) ?? "—"}
        color={(ctx.rsi ?? 50) > 70 ? C.red : (ctx.rsi ?? 50) < 30 ? C.green : C.text} />
      <StatBox label="ATR"      value={ctx.atr?.toFixed(3) ?? "—"} />
      <StatBox label="Day Type" value={regimeLabel} color={regimeColor} mono={false} />
    </div>
  );
}

function TradeLog({ trades }: { trades: TradeRecord[] }) {
  if (!trades.length) return (
    <div style={{ padding: "20px", textAlign: "center", fontFamily: FONT_BODY,
      fontSize: "12px", color: C.faint }}>
      No trades yet this session.
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_MONO, fontSize: "10px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Time", "Action", "Qty", "Price", "Stop", "Target", "P&L", "Mode", "Why"].map(h => (
              <th key={h} style={{ padding: "4px 8px", textAlign: "left",
                fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...trades].reverse().map((t, i) => {
            const color = ACTION_COLOR[t.action] ?? C.text;
            const isEntry = t.action.startsWith("entry");
            // Extract just the signal names from the reason string for compact display
            const whyShort = (() => {
              if (!t.reason) return "—";
              const m = t.reason.match(/:\s*([^.]+)\./);
              if (m) return m[1].trim().replace(/_/g, " ");
              return t.reason.slice(0, 40);
            })();
            return (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)22" }}>
                <td style={{ padding: "5px 8px", color: C.faint, fontSize: "9px" }}>
                  {t.ts.replace(/^\d{4}-\d{2}-\d{2} /, "")}
                </td>
                <td style={{ padding: "5px 8px", color, fontWeight: 700 }}>
                  {t.action.replace(/_/g, " ").toUpperCase()}
                </td>
                <td style={{ padding: "5px 8px", color: C.text }}>{t.qty}</td>
                <td style={{ padding: "5px 8px", color: C.text }}>${t.price.toFixed(2)}</td>
                <td style={{ padding: "5px 8px", color: C.red }}>
                  {t.stop_price > 0 ? `$${t.stop_price.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "5px 8px", color: C.green }}>
                  {t.target_price > 0 ? `$${t.target_price.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "5px 8px",
                  color: t.pnl_pct > 0 ? C.green : t.pnl_pct < 0 ? C.red : C.faint,
                  fontWeight: isEntry ? 400 : 700 }}>
                  {isEntry ? "—" : `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%`}
                </td>
                <td style={{ padding: "5px 8px", color: C.faint, fontSize: "9px" }}>
                  {t.dry_run ? "DRY" : "LIVE"}
                </td>
                <td style={{ padding: "5px 8px", color: C.muted, fontSize: "9px",
                  maxWidth: "180px", whiteSpace: "nowrap", overflow: "hidden",
                  textOverflow: "ellipsis" }}
                  title={t.reason}>
                  {whyShort}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Setup form ────────────────────────────────────────────────────────────────

interface SetupFormProps {
  onStart: (cfg: {
    symbol: string; direction: number; account_size: number;
    risk_per_trade_pct: number; max_trades: number; dry_run: boolean;
    notify_email: string;
  }) => void;
  loading: boolean;
  portfolioCapital: number;
}

function SetupForm({ onStart, loading, portfolioCapital }: SetupFormProps) {
  const [symbol,       setSymbol]       = useState("AAPL");
  const [direction,    setDirection]    = useState<1 | -1>(1);
  const [acct,         setAcct]         = useState(String(portfolioCapital));
  const [risk,         setRisk]         = useState(1.0);  // spec: 0.5–2.0%
  const [maxTrades,    setMaxTrades]    = useState(5);
  const [dryRun,       setDryRun]       = useState(true);
  const [liveConfirm,  setLiveConfirm]  = useState(false);  // LIVE modal state
  const [notifyEmail,  setNotifyEmail]  = useState("");

  const parsedAcct = parseFloat(acct.replace(/[^0-9.]/g, "")) || portfolioCapital;

  function handleToggleDryRun() {
    if (dryRun) {
      // Switching TO live — show confirmation modal first
      setLiveConfirm(true);
    } else {
      setDryRun(true);
    }
  }

  function handleStart() {
    onStart({
      symbol:             symbol.toUpperCase().trim(),
      direction,
      account_size:       parsedAcct,
      risk_per_trade_pct: risk,
      max_trades:         maxTrades,
      dry_run:            dryRun,
      notify_email:       notifyEmail.trim(),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* LIVE mode confirmation modal */}
      {liveConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.65)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#0B1F3A", border: "2px solid #C41E3A",
            padding: "28px 32px", maxWidth: "440px", width: "90%",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <AlertTriangle size={20} style={{ color: C.red, flexShrink: 0 }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: "14px", fontWeight: 900,
                color: "#FFFFFF", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Switching to LIVE Mode
              </span>
            </div>
            <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "rgba(255,255,255,0.85)",
              lineHeight: 1.7, margin: "0 0 8px" }}>
              <strong style={{ color: C.red }}>Real money will be at risk.</strong> The agent will submit
              actual orders to your Alpaca account. Trades execute immediately with real dollars.
            </p>
            <ul style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "rgba(255,255,255,0.7)",
              lineHeight: 1.8, paddingLeft: "18px", margin: "0 0 20px" }}>
              <li>Ensure your Alpaca account has sufficient buying power</li>
              <li>Paper trading mode must be OFF in your Alpaca dashboard for real execution</li>
              <li>Stops are submitted as bracket orders — confirmed at fill</li>
              <li>Max loss this session: {fmt$(parsedAcct * risk / 100 * maxTrades)}</li>
            </ul>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => { setDryRun(false); setLiveConfirm(false); }}
                style={{
                  flex: 1, padding: "10px", fontFamily: FONT_MONO, fontSize: "12px",
                  fontWeight: 800, background: C.red, color: "#fff",
                  border: "none", cursor: "pointer", textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Yes, Enable Live Orders
              </button>
              <button
                onClick={() => setLiveConfirm(false)}
                style={{
                  flex: 1, padding: "10px", fontFamily: FONT_MONO, fontSize: "12px",
                  fontWeight: 700, background: "transparent", color: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direction + symbol */}
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
          1. Your directional view for today
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Symbol */}
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={6}
            style={{
              fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 800,
              width: "90px", padding: "8px 12px", textAlign: "center",
              color: C.text, background: "var(--bg-raised)",
              border: "2px solid var(--border)", outline: "none",
              textTransform: "uppercase",
            }}
          />
          {/* Direction buttons */}
          <button
            onClick={() => setDirection(1)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "10px 20px", fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
              background: direction === 1 ? "rgba(26,107,74,0.15)" : "var(--bg-raised)",
              color: direction === 1 ? C.green : C.muted,
              border: `2px solid ${direction === 1 ? C.green : "var(--border)"}`,
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <TrendingUp size={16} /> LONG
          </button>
          <button
            onClick={() => setDirection(-1)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "10px 20px", fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
              background: direction === -1 ? "rgba(196,30,58,0.12)" : "var(--bg-raised)",
              color: direction === -1 ? C.red : C.muted,
              border: `2px solid ${direction === -1 ? C.red : "var(--border)"}`,
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <TrendingDown size={16} /> SHORT
          </button>
        </div>
        <p style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.faint, marginTop: "8px" }}>
          You provide the directional conviction. The algorithm provides the timing, sizing, and discipline.
        </p>
      </div>

      {/* Risk config */}
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
          2. Risk configuration
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          {/* Account size */}
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
              marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Account size
            </div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "8px", top: "50%",
                transform: "translateY(-50%)", color: C.muted, fontFamily: FONT_MONO }}>$</span>
              <input
                type="text" inputMode="numeric"
                value={acct}
                onChange={e => setAcct(e.target.value.replace(/[^0-9.]/g, ""))}
                style={{
                  width: "100%", padding: "8px 8px 8px 20px",
                  fontFamily: FONT_MONO, fontSize: "14px", fontWeight: 700,
                  color: C.text, background: "var(--bg-raised)",
                  border: "1px solid var(--border)", outline: "none",
                }}
              />
            </div>
          </div>
          {/* Risk per trade */}
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
              marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Risk per trade
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
              color: C.red, marginBottom: "4px" }}>
              {risk.toFixed(1)}% = {fmt$(parsedAcct * risk / 100)}
            </div>
            <input type="range" min={0.5} max={2} step={0.25} value={risk}
              onChange={e => setRisk(Number(e.target.value))}
              className="w-full" style={{ accentColor: C.red }} />
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint, marginTop: "2px" }}>
              Max loss per trade if stop is hit
            </div>
          </div>
          {/* Max trades */}
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
              marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Max trades today
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
              color: C.blue, marginBottom: "4px" }}>
              {maxTrades}
            </div>
            <input type="range" min={1} max={5} step={1} value={maxTrades}
              onChange={e => setMaxTrades(Number(e.target.value))}
              className="w-full" style={{ accentColor: C.blue }} />
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint, marginTop: "2px" }}>
              Max daily loss: {fmt$(parsedAcct * risk / 100 * maxTrades)}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
              marginTop: "4px", lineHeight: 1.5 }}>
              {maxTrades === 1 && "1 trade: maximum conviction — wait for the perfect setup only."}
              {maxTrades === 2 && "2 trades: high discipline — one entry attempt, one retry."}
              {maxTrades === 3 && "3 trades: balanced — typical active day with strict filtering."}
              {maxTrades === 4 && "4 trades: active — expect more false signals in choppy markets."}
              {maxTrades === 5 && "5 trades: maximum — agent stops when daily loss cap is hit first."}
            </div>
          </div>
        </div>
      </div>

      {/* Email notifications */}
      <div style={{ paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          Email alerts (optional)
        </div>
        <input
          type="email"
          value={notifyEmail}
          onChange={e => setNotifyEmail(e.target.value)}
          placeholder="your@email.com"
          style={{
            width: "100%", padding: "8px 12px",
            fontFamily: FONT_MONO, fontSize: "12px",
            color: C.text, background: "var(--bg-raised)",
            border: "1px solid var(--border)", outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint, marginTop: "4px" }}>
          Get notified on entry, exit, and session end. Leave blank to skip.
        </div>
      </div>

      {/* Mode + launch */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px",
        paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        {/* Dry run toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: "8px",
          fontFamily: FONT_BODY, fontSize: "12px", color: C.muted, cursor: "pointer" }}>
          <button
            onClick={handleToggleDryRun}
            style={{
              width: "36px", height: "20px", borderRadius: "9999px",
              background: dryRun ? C.amber : C.green,
              border: "none", cursor: "pointer", position: "relative",
              transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: "2px",
              left: dryRun ? "2px" : "18px",
              width: "16px", height: "16px",
              background: "#fff", borderRadius: "50%",
              transition: "left 0.2s",
            }} />
          </button>
          {dryRun ? "Dry Run (no real orders)" : "Live Orders"}
        </label>

        <button
          onClick={handleStart}
          disabled={loading || !symbol.trim()}
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "12px 28px", fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
            background: loading ? "var(--bg-active)" : direction === 1 ? C.green : C.red,
            color: "#fff", border: "none",
            cursor: loading || !symbol.trim() ? "not-allowed" : "pointer",
            opacity: loading || !symbol.trim() ? 0.6 : 1,
            transition: "all 0.15s",
          }}
        >
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? "Starting…" : `Start ${direction === 1 ? "LONG" : "SHORT"} on ${symbol || "?"}`}
        </button>
      </div>

      {!dryRun && (
        <div style={{ display: "flex", gap: "8px", padding: "10px 12px",
          background: "rgba(196,30,58,0.06)", border: "1px solid rgba(196,30,58,0.3)" }}>
          <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0, marginTop: "1px" }} />
          <p style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.red, margin: 0 }}>
            <strong>Live mode.</strong> Real Alpaca orders will be submitted. Ensure paper trading is enabled
            in your Alpaca account settings or you have reviewed all risk parameters.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Active session view ───────────────────────────────────────────────────────

function ActiveSession({ status, onStop }: { status: IntradayStatus; onStop: () => void }) {
  const state = status.state;
  const stateColor = STATE_COLOR[state] ?? C.faint;
  const isActive = ["waiting", "in_position", "scaling_out"].includes(state);
  const totalPnl = status.realized_pnl + status.unrealized_pnl;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: "20px", fontWeight: 900, color: C.text }}>
            {status.symbol}
          </span>
          <span style={{
            fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 800,
            padding: "3px 10px",
            background: status.direction === 1 ? "rgba(26,107,74,0.12)" : "rgba(196,30,58,0.10)",
            color: status.direction === 1 ? C.green : C.red,
            border: `1px solid ${status.direction === 1 ? C.green : C.red}55`,
          }}>
            {status.direction_word}
          </span>
          <StateChip state={state} />
          {isActive && (
            <span style={{ display: "flex", alignItems: "center", gap: "4px",
              fontFamily: FONT_BODY, fontSize: "9px", color: C.faint }}>
              <Activity size={10} className="animate-pulse" /> live
            </span>
          )}
        </div>
        {isActive && (
          <button
            onClick={onStop}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "6px 14px", fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700,
              background: "rgba(196,30,58,0.08)",
              color: C.red, border: `1px solid ${C.red}55`, cursor: "pointer",
            }}
          >
            <Square size={12} /> Stop Agent
          </button>
        )}
      </div>

      {/* Error banner */}
      {status.error && (
        <div style={{ display: "flex", gap: "8px", padding: "10px 12px",
          background: "rgba(196,30,58,0.07)", border: `1px solid ${C.red}44` }}>
          <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0 }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.red }}>{status.error}</span>
        </div>
      )}

      {/* P&L summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
        <StatBox
          label="Total P&L"
          value={`${totalPnl >= 0 ? "+" : ""}${fmt$(Math.abs(totalPnl))}`}
          color={totalPnl > 0 ? C.green : totalPnl < 0 ? C.red : C.text}
        />
        <StatBox
          label="Unrealized"
          value={fmtPnl(status.unrealized_pnl) + (status.unrealized_pct !== 0 ? ` (${status.unrealized_pct >= 0 ? "+" : ""}${status.unrealized_pct.toFixed(2)}%)` : "")}
          color={status.unrealized_pnl >= 0 ? C.green : C.red}
        />
        <StatBox
          label="Realized"
          value={fmtPnl(status.realized_pnl)}
          color={status.realized_pnl >= 0 ? C.green : C.red}
        />
        <StatBox
          label="Max Drawdown"
          value={status.max_drawdown < 0 ? fmt$(Math.abs(status.max_drawdown)) : "—"}
          color={status.max_drawdown < -0.01 ? C.red : C.faint}
        />
        <StatBox
          label={`Trades (${status.trades_today}/${status.max_trades})`}
          value={`${status.max_trades - status.trades_today} left`}
          color={status.trades_today >= status.max_trades ? C.red : C.text}
        />
      </div>

      {/* In-position details */}
      {status.current_qty !== 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
          <StatBox label="Position" value={`${Math.abs(status.current_qty)} shares`} />
          <StatBox label="Avg Entry" value={`$${status.avg_entry_price.toFixed(2)}`} />
          <StatBox label="Stop Loss"
            value={status.stop_price > 0 ? `$${status.stop_price.toFixed(2)}` : "—"}
            color={C.red} />
          <StatBox label="Target"
            value={status.target_price > 0 ? `$${status.target_price.toFixed(2)}` : "—"}
            color={C.green} />
        </div>
      )}

      {/* Live context: VWAP / RSI / ATR / ORB */}
      {status.context && Object.keys(status.context).length > 0 && (
        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            Live market context
          </div>
          <ContextBar ctx={status.context} />
          {status.context.orb_high ? (
            <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: C.faint, marginTop: "4px" }}>
              Opening Range: ${status.context.orb_low?.toFixed(2)} — ${status.context.orb_high?.toFixed(2)} ·{" "}
              {status.context.bar_count} bars · {status.context.above_vwap ? "above" : "below"} VWAP
            </div>
          ) : null}
        </div>
      )}

      {/* Last signal / gap warning */}
      {status.last_signal_reason && (() => {
        const isWarning = status.last_signal_reason.startsWith("WARNING:");
        return (
          <div style={{ padding: "8px 12px",
            background: isWarning ? "rgba(139,105,20,0.08)" : "var(--bg-raised)",
            border: `1px solid ${isWarning ? "rgba(139,105,20,0.4)" : "var(--border)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px",
              fontFamily: FONT_BODY, fontSize: "9px", color: isWarning ? C.amber : C.faint,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>
              {isWarning && <AlertTriangle size={10} style={{ color: C.amber }} />}
              {isWarning ? "Gap Warning" : "Last signal assessment"}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "11px",
              color: isWarning ? "#6B5010" : C.muted, lineHeight: 1.6 }}>
              {status.last_signal_reason}
            </div>
            {status.last_update && (
              <div style={{ fontFamily: FONT_MONO, fontSize: "9px", color: C.faint, marginTop: "4px" }}>
                <Clock size={9} style={{ display: "inline", marginRight: "3px" }} />
                {status.last_update}
              </div>
            )}
          </div>
        );
      })()}

      {/* Trade log */}
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
          Session trade log
        </div>
        <div style={{ border: "1px solid var(--border)" }}>
          <TradeLog trades={status.trades} />
        </div>
      </div>

      {/* Session closed summary */}
      {state === "closed" && (
        <div style={{ padding: "14px 16px",
          background: totalPnl >= 0 ? "rgba(26,107,74,0.06)" : "rgba(196,30,58,0.06)",
          border: `1px solid ${totalPnl >= 0 ? C.green : C.red}44` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle size={14} style={{ color: totalPnl >= 0 ? C.green : C.red }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: "13px", fontWeight: 700,
              color: totalPnl >= 0 ? C.green : C.red }}>
              Session Complete — {status.trades_today} trade{status.trades_today !== 1 ? "s" : ""} ·{" "}
              {fmtPnl(totalPnl)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session history ───────────────────────────────────────────────────────────

interface SessionSummary {
  date:           string;
  symbol:         string;
  direction:      number;
  direction_word: string;
  trades:         number;
  realized_pnl:   number;
  max_drawdown:   number;
  dry_run:        boolean;
  closed_at:      string;
}

function SessionHistory({ sessions }: { sessions: SessionSummary[] }) {
  if (!sessions.length) return null;
  return (
    <div style={{ marginTop: "16px", padding: "16px 20px", background: "var(--bg-raised)",
      border: "1px solid var(--border)" }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
        Track Record — Past Sessions
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_MONO, fontSize: "10px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Date", "Symbol", "Dir", "Trades", "P&L", "Max DD", "Mode", "Closed"].map(h => (
                <th key={h} style={{ padding: "4px 8px", textAlign: "left",
                  fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)22" }}>
                <td style={{ padding: "5px 8px", color: C.faint, fontSize: "9px" }}>{s.date}</td>
                <td style={{ padding: "5px 8px", fontWeight: 800 }}>{s.symbol}</td>
                <td style={{ padding: "5px 8px",
                  color: s.direction === 1 ? C.green : C.red, fontWeight: 700 }}>
                  {s.direction_word}
                </td>
                <td style={{ padding: "5px 8px" }}>{s.trades}</td>
                <td style={{ padding: "5px 8px", fontWeight: 700,
                  color: s.realized_pnl >= 0 ? C.green : C.red }}>
                  {s.realized_pnl >= 0 ? "+" : ""}{fmt$(Math.abs(s.realized_pnl))}
                </td>
                <td style={{ padding: "5px 8px", color: s.max_drawdown < 0 ? C.red : C.faint }}>
                  {s.max_drawdown < 0 ? fmt$(Math.abs(s.max_drawdown)) : "—"}
                </td>
                <td style={{ padding: "5px 8px", color: C.faint, fontSize: "9px" }}>
                  {s.dry_run ? "DRY" : "LIVE"}
                </td>
                <td style={{ padding: "5px 8px", color: C.faint, fontSize: "9px" }}>
                  {s.closed_at.replace(/^\d{4}-\d{2}-\d{2} /, "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function IntradayPanel() {
  const { portfolioCapital, onboarding } = useTrader();
  const [status,    setStatus]    = useState<IntradayStatus | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [history,   setHistory]   = useState<SessionSummary[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = status && ["waiting", "in_position", "scaling_out"].includes(status.state);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/intraday/history?limit=10", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { sessions: SessionSummary[] };
      setHistory(data.sessions ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/intraday/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as IntradayStatus;
      setStatus(data);
      // Stop polling when session is complete; refresh history
      if (["closed", "error", "idle"].includes(data.state) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        fetchHistory();
      }
    } catch { /* network error — keep polling */ }
  }, [fetchHistory]);

  // Start polling when active
  useEffect(() => {
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 15_000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isActive, fetchStatus]);

  // Load initial status and history on mount
  useEffect(() => {
    fetchStatus();
    fetchHistory();
  }, [fetchStatus, fetchHistory]);

  async function handleStart(cfg: {
    symbol: string; direction: number; account_size: number;
    risk_per_trade_pct: number; max_trades: number; dry_run: boolean;
    notify_email: string;
  }) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intraday/start", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(cfg),
      });
      const data = await res.json() as { ok?: boolean; detail?: string };
      if (!res.ok) {
        setError(data.detail ?? `HTTP ${res.status}`);
      } else {
        await fetchStatus();
        // Begin polling
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(fetchStatus, 15_000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    try {
      await fetch("/api/intraday/stop", { method: "POST" });
      await fetchStatus();
    } catch { /* ignore */ }
  }

  const showSetup = !status || status.state === "idle" ||
    (status.state === "closed" || status.state === "error");

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "16px 0" }}>
      {/* Broker-not-connected notice */}
      {!onboarding.brokerConnected && (
        <div style={{
          display: "flex", gap: "10px", alignItems: "flex-start",
          padding: "12px 16px", marginBottom: "16px",
          background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.3)",
        }}>
          <AlertTriangle size={14} style={{ color: "#92400E", flexShrink: 0, marginTop: "2px" }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "#78350F", lineHeight: 1.6 }}>
            <strong>No broker connected.</strong> Intraday sessions will run in dry-run mode only.
            Orders will be logged but not submitted to a broker. Connect Alpaca in your profile to enable live paper or live trading.
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{
          fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 800,
          letterSpacing: "0.2em", textTransform: "uppercase",
          color: C.faint, marginBottom: "4px",
        }}>
          Intraday Execution Agent
        </div>
        <h1 style={{ fontFamily: FONT_BODY, fontSize: "22px", fontWeight: 700,
          color: C.text, margin: 0 }}>
          You pick the stock. We execute with discipline.
        </h1>
        <p style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.muted,
          marginTop: "6px", lineHeight: 1.7 }}>
          The algorithm enters at the best technical moment (ORB break, VWAP reclaim, ATR impulse),
          enforces your stop loss automatically, scales out at 3:15 PM, and closes everything by 3:45 PM ET.
          No ML models. No black box. Pure algorithmic discipline on 1-minute bars.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ display: "flex", gap: "8px", padding: "10px 14px", marginBottom: "16px",
          background: "rgba(196,30,58,0.07)", border: `1px solid ${C.red}44` }}>
          <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0, marginTop: "1px" }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.red }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none",
            border: "none", color: C.red, cursor: "pointer", fontSize: "12px" }}>✕</button>
        </div>
      )}

      <div className="panel" style={{ padding: "20px" }}>
        {showSetup ? (
          <>
            {/* Show previous session summary before new setup form */}
            {status && status.state !== "idle" && (
              <div style={{ marginBottom: "24px", paddingBottom: "20px",
                borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                  Previous session — {status.symbol} {status.direction_word}
                </div>
                <ActiveSession status={status} onStop={handleStop} />
              </div>
            )}
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px" }}>
              {status?.state === "closed" ? "Start a new session" : "Set up your session"}
            </div>
            <SetupForm
              onStart={handleStart}
              loading={loading}
              portfolioCapital={portfolioCapital}
            />
          </>
        ) : (
          <ActiveSession status={status!} onStop={handleStop} />
        )}
      </div>

      {/* Cross-session track record */}
      <SessionHistory sessions={history} />

      {/* Methodology note */}
      <div style={{
        marginTop: "16px", padding: "12px 16px",
        background: "rgba(155,146,128,0.05)", border: "1px solid rgba(155,146,128,0.18)",
        fontFamily: FONT_BODY, fontSize: "10px", color: C.faint, lineHeight: 1.7,
      }}>
        <strong style={{ color: C.muted }}>How signals work:</strong>{" "}
        Entry fires when ≥ 2 of 3 conditions agree: (1) Opening Range Breakout — price breaks the
        first-15-min high/low with ≥1.5× volume; (2) VWAP Reclaim — price crosses the volume-weighted
        average price with a volume surge; (3) ATR Impulse — a single bar moves ≥0.6× the 14-bar ATR
        with above-average volume. RSI(9) &gt; 75 blocks new longs; RSI(9) &lt; 25 blocks new shorts.
        Stop = 1.5× ATR. Target = 2.5:1 R:R. Not financial advice.
      </div>
    </div>
  );
}
