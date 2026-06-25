"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AgentConfig, type AgentStatus, type JournalEntry, type AgentDigest, type TradeDebrief, type CircuitBreakerStatus } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { useTrader } from "@/store/trader";
import {
  Bot, Play, Square, RefreshCw, Settings, BookOpen,
  Sunrise, AlertTriangle, CheckCircle, Clock, Zap,
  ChevronDown, ChevronUp, Plus, X, TrendingUp, TrendingDown, Minus,
  FileText, Loader2, ShieldAlert, ShieldCheck, Share2,
} from "lucide-react";
import type { AgentTrackRecord, TrackRecordEntry } from "@/lib/api";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type PanelTab = "status" | "config" | "journal" | "digest" | "track-record" | "circuit-breaker";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SignalChip({ signal }: { signal: number }) {
  if (signal === 1)  return <span style={{ color: "var(--green)", fontWeight: 700, fontSize: "10px" }}>▲ LONG</span>;
  if (signal === -1) return <span style={{ color: "var(--red)",   fontWeight: 700, fontSize: "10px" }}>▼ SHORT</span>;
  return <span style={{ color: "var(--yellow)", fontSize: "10px" }}>◆ FLAT</span>;
}

function SideChip({ side }: { side: string }) {
  const map: Record<string, { color: string; label: string }> = {
    buy:   { color: "var(--green)",  label: "BUY" },
    sell:  { color: "var(--red)",    label: "SELL" },
    skip:  { color: "var(--text-muted)", label: "SKIP" },
    error: { color: "var(--yellow)", label: "ERROR" },
  };
  const s = map[side] ?? { color: "var(--text-muted)", label: side.toUpperCase() };
  return <span style={{ color: s.color, fontWeight: 700, fontSize: "10px", fontFamily: FONT_MONO }}>{s.label}</span>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPanel({ status, onRunOnce, running }: {
  status: AgentStatus | null;
  onRunOnce: () => void;
  running: boolean;
}) {
  if (!status) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );

  const isActive = status.enabled && !status.dry_run;

  return (
    <div className="space-y-3">
      {/* Master status card */}
      <div className="panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Bot className="h-8 w-8" style={{ color: status.enabled ? "var(--green)" : "var(--text-muted)" }} />
              {status.running && (
                <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full animate-pulse"
                  style={{ background: "var(--green)" }} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                  Auto-Trade Agent
                </span>
                <span style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
                  padding: "2px 6px",
                  background: status.enabled ? "var(--green-dim)" : "var(--bg-raised)",
                  color: status.enabled ? "var(--green)" : "var(--text-muted)",
                  border: `1px solid ${status.enabled ? "var(--green)44" : "var(--border)"}`,
                }}>
                  {status.enabled ? (status.dry_run ? "DRY RUN" : "LIVE") : "DISABLED"}
                </span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY }}>
                {status.running ? "Executing cycle…" :
                 status.last_run_ts ? `Last run: ${status.last_run_ts}` : "Never run"}
              </div>
            </div>
          </div>

          <button
            onClick={onRunOnce}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              background: "var(--blue-dim)", color: "var(--blue)",
              border: "1px solid var(--blue)", cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running
              ? <><RefreshCw className="h-3 w-3 animate-spin" />Running…</>
              : <><Play className="h-3 w-3" />Run Now</>
            }
          </button>
        </div>

        {/* Summary */}
        {status.last_run_summary && (
          <div className="mt-3 px-3 py-2 text-xs"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", fontFamily: FONT_BODY, color: "var(--text-secondary)" }}>
            {status.last_run_summary}
          </div>
        )}

        {/* Error */}
        {status.error && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 text-xs"
            style={{ background: "var(--red-dim)", border: "1px solid var(--red)44", color: "var(--red)" }}>
            <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span style={{ fontFamily: FONT_MONO }}>{status.error}</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Trades Logged",  value: status.journal_count, icon: <BookOpen className="h-3 w-3" /> },
          { label: "Mode",           value: status.dry_run ? "Dry Run" : "Live Orders", icon: <Zap className="h-3 w-3" /> },
          { label: "Agent Status",   value: status.running ? "Running" : "Idle", icon: <Clock className="h-3 w-3" /> },
          { label: "Digest Sent",    value: status.last_digest_date || "Never", icon: <Sunrise className="h-3 w-3" /> },
        ].map(s => (
          <div key={s.label} className="panel p-3">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
              {s.icon} {s.label}
            </div>
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)", fontFamily: FONT_MONO }}>
              {String(s.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Paper account performance */}
      {status.dry_run && status.paper_trades_count > 0 && (
        <div className="panel p-4">
          <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
            Paper Account Performance
          </div>
          <div className="flex items-center gap-4">
            <div>
              <div className="text-xl font-bold" style={{
                fontFamily: FONT_MONO,
                color: status.paper_trades_pnl >= 0 ? "var(--green)" : "var(--red)",
              }}>
                {status.paper_trades_pnl >= 0 ? "+" : ""}
                {fmt$(status.paper_trades_pnl)}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY }}>
                cumulative P&amp;L · {status.paper_trades_count} resolved trade{status.paper_trades_count !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily loss cap halt banner */}
      {status.daily_loss_halted && (
        <div className="flex items-start gap-2 p-3 text-xs"
          style={{ background: "rgba(196,30,58,0.18)", border: "2px solid var(--red)", color: "var(--red)" }}>
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span style={{ fontFamily: FONT_BODY }}>
            <strong>Daily loss cap triggered.</strong> The agent has been halted for today after
            the portfolio declined by {status.daily_loss_cap_pct}% or more.
            It will automatically resume tomorrow. No new orders will be submitted today.
          </span>
        </div>
      )}

      {/* Warning if live */}
      {isActive && (
        <div className="flex items-start gap-2 p-3 text-xs"
          style={{ background: "var(--red-dim)", border: "1px solid var(--red)44", color: "var(--red)" }}>
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span style={{ fontFamily: FONT_BODY }}>
            <strong>Live trading is active.</strong> The agent will submit real Alpaca orders.
            Ensure your Alpaca API keys are set and you have reviewed the strategy config.
          </span>
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ config, onSave, saving }: {
  config: AgentConfig | null;
  onSave: (c: Partial<AgentConfig>) => void;
  saving: boolean;
}) {
  const [local, setLocal]       = useState<AgentConfig | null>(null);
  const [symInput, setSymInput] = useState("");
  const [sharing,  setSharing]  = useState(false);
  const [copied,   setCopied]   = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const { blob } = await api.agent.exportConfig();
      const url = `${window.location.origin}/onboarding?agent=${blob}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast("Failed to copy share link", "error");
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    if (config && !local) setLocal({ ...config, horizon: config.horizon ?? "swing" });
  }, [config, local]);

  if (!local) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );

  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setLocal(prev => prev ? { ...prev, [k]: v } : prev);

  const addSym = () => {
    const s = symInput.trim().toUpperCase();
    if (!s || local.symbols.includes(s)) return;
    set("symbols", [...local.symbols, s]);
    setSymInput("");
  };

  const removeSym = (s: string) =>
    set("symbols", local.symbols.filter(x => x !== s));

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">
          <span>Strategy Engine Configuration</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              disabled={sharing}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              title="Copy shareable link to this agent config"
            >
              {copied
                ? <><CheckCircle className="h-3 w-3" />Copied!</>
                : sharing
                  ? <><RefreshCw className="h-3 w-3 animate-spin" />Sharing…</>
                  : <><Share2 className="h-3 w-3" />Share</>
              }
            </button>
            <button
              onClick={() => onSave(local)}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green)44" }}
            >
              {saving ? <><RefreshCw className="h-3 w-3 animate-spin" />Saving…</> : <><CheckCircle className="h-3 w-3" />Save Config</>}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5">

          {/* Master toggle */}
          <div className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Agent Enabled</div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY }}>
                When on, the agent scans symbols on the configured interval and evaluates signals.
              </div>
            </div>
            <button
              onClick={() => set("enabled", !local.enabled)}
              className="relative inline-flex h-5 w-9 items-center transition-colors"
              style={{ background: local.enabled ? "var(--green)" : "var(--bg-active)", borderRadius: "9999px" }}
            >
              <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                style={{ transform: local.enabled ? "translateX(18px)" : "translateX(2px)" }} />
            </button>
          </div>

          {/* Dry run toggle */}
          <div className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dry Run Mode</div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY }}>
                Log decisions and sizing without submitting real orders. Recommended until you trust the strategy.
              </div>
            </div>
            <button
              onClick={() => set("dry_run", !local.dry_run)}
              className="relative inline-flex h-5 w-9 items-center transition-colors"
              style={{ background: local.dry_run ? "var(--blue)" : "var(--red)", borderRadius: "9999px" }}
            >
              <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                style={{ transform: local.dry_run ? "translateX(18px)" : "translateX(2px)" }} />
            </button>
          </div>

          {/* Allow short */}
          <div className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Allow Short Signals</div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY }}>
                When off, only LONG (buy) signals are executed. Shorts require margin and carry higher risk.
              </div>
            </div>
            <button
              onClick={() => set("allow_short", !local.allow_short)}
              className="relative inline-flex h-5 w-9 items-center transition-colors"
              style={{ background: local.allow_short ? "var(--yellow)" : "var(--bg-active)", borderRadius: "9999px" }}
            >
              <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                style={{ transform: local.allow_short ? "translateX(18px)" : "translateX(2px)" }} />
            </button>
          </div>

          {/* Numeric params */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {([
              { key: "min_confidence" as const,      label: "Min Confidence",   desc: "Only trade signals above this threshold.", min: 0.5, max: 0.99, step: 0.01, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
              { key: "kelly_cap_pct"  as const,      label: "Kelly Cap %",      desc: "Hard cap: never risk more than X% per trade.", min: 1, max: 50, step: 0.5, fmt: (v: number) => `${v}%` },
              { key: "daily_loss_cap_pct" as const,  label: "Daily Loss Cap",   desc: "Halt agent for the day if portfolio drops this much.", min: 0.5, max: 10, step: 0.5, fmt: (v: number) => `−${v}%` },
              { key: "max_concentration_pct" as const, label: "Max Concentration", desc: "Skip new entries if open positions already exceed X% of portfolio.", min: 10, max: 100, step: 5, fmt: (v: number) => `${v}%` },
              { key: "poll_interval_min" as const,   label: "Poll Interval",    desc: "Minutes between automatic scan cycles.", min: 5, max: 240, step: 5, fmt: (v: number) => `${v} min` },
            ] as const).map(param => (
              <div key={param.key}>
                <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>{param.label}</div>
                <div className="text-sm font-bold num mb-1" style={{ color: "var(--blue)", fontFamily: FONT_MONO }}>
                  {param.fmt(local[param.key] as number)}
                </div>
                <input
                  type="range"
                  min={param.min} max={param.max} step={param.step}
                  value={local[param.key] as number}
                  onChange={e => set(param.key, Number(e.target.value) as AgentConfig[typeof param.key])}
                  className="w-full h-1 accent-blue-500"
                  style={{ accentColor: "var(--blue)" }}
                />
                <div className="text-[9px] mt-1" style={{ color: "var(--text-disabled)", fontFamily: FONT_BODY }}>{param.desc}</div>
              </div>
            ))}
          </div>

          {/* Analysis horizon */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)", letterSpacing: "0.12em" }}>
              Analysis Horizon
            </div>
            <div className="text-[9px] mb-2" style={{ color: "var(--text-disabled)", fontFamily: FONT_BODY }}>
              Which time frame the agent scores signals for. Set by your trading goal in onboarding — change it here anytime.
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {(["day", "swing", "month", "quarter", "year"] as const).map(h => {
                const labels: Record<string, string> = { day: "Day Trade", swing: "Swing (1-4w)", month: "1 Month", quarter: "3 Months", year: "6-12 Months" };
                const active = local.horizon === h;
                return (
                  <button key={h}
                    onClick={() => set("horizon", h)}
                    style={{
                      fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 600,
                      padding: "4px 10px",
                      background: active ? "var(--blue)" : "var(--bg-raised)",
                      color: active ? "#fff" : "var(--text-muted)",
                      border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {labels[h]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Watchlist symbols */}
          <div>
            <div className="text-[9px] uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              Symbols to Watch ({local.symbols.length})
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {local.symbols.map(s => (
                <span key={s} className="flex items-center gap-1 px-2 py-0.5"
                  style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", fontSize: "11px", fontFamily: FONT_MONO, color: "var(--text-primary)" }}>
                  {s}
                  <button onClick={() => removeSym(s)} style={{ color: "var(--text-muted)" }} className="hover:text-red-400">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={symInput}
                onChange={e => setSymInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && addSym()}
                placeholder="Add symbol…"
                className="et-input w-32 text-xs font-mono uppercase"
                style={{ padding: "4px 8px" }}
              />
              <button onClick={addSym}
                className="flex items-center gap-1 px-2 py-1 text-xs"
                style={{ background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue)44" }}>
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
          </div>

          {/* Email notifications */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
            <div className="text-[9px] uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)", letterSpacing: "0.16em" }}>
              Email Notifications
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Send alerts to</div>
                <input
                  type="email"
                  value={local.notify_email}
                  onChange={e => set("notify_email", e.target.value)}
                  placeholder="you@example.com"
                  className="et-input text-xs"
                  style={{ padding: "4px 8px" }}
                />
              </div>
              <div className="text-[10px] pt-4" style={{ color: "var(--text-muted)", fontFamily: FONT_BODY, lineHeight: 1.6 }}>
                Set <code style={{ fontFamily: FONT_MONO, background: "var(--bg-raised)", padding: "0 4px" }}>SMTP_HOST</code>,{" "}
                <code style={{ fontFamily: FONT_MONO, background: "var(--bg-raised)", padding: "0 4px" }}>SMTP_USER</code>,{" "}
                <code style={{ fontFamily: FONT_MONO, background: "var(--bg-raised)", padding: "0 4px" }}>SMTP_PASS</code> in{" "}
                <code style={{ fontFamily: FONT_MONO, background: "var(--bg-raised)", padding: "0 4px" }}>.env.local</code>{" "}
                to enable email alerts on live trade execution.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DebriefCard ───────────────────────────────────────────────────────────────

function DebriefCard({ tradeId, onClose }: { tradeId: string; onClose: () => void }) {
  const [debrief, setDebrief] = useState<TradeDebrief | null>(null);
  const [loading, setLoading]  = useState(true);
  const [error,   setError]    = useState("");

  useEffect(() => {
    api.agent.getDebrief(tradeId)
      .then(setDebrief)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load debrief"))
      .finally(() => setLoading(false));
  }, [tradeId]);

  const outcomeColor = debrief?.outcome === "win" ? "var(--green)"
    : debrief?.outcome === "loss" ? "var(--red)"
    : debrief?.outcome === "pending" ? "var(--yellow)"
    : "var(--text-muted)";

  const outcomeLabel = debrief?.outcome === "win" ? "✓ Win"
    : debrief?.outcome === "loss" ? "✗ Loss"
    : debrief?.outcome === "pending" ? "⏳ Pending"
    : "— Flat";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{
        background: "var(--panel-bg)", border: "1px solid var(--border)",
        borderRadius: "8px", width: "100%", maxWidth: "560px",
        maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" style={{ color: "var(--blue)" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
              Post-Trade Debrief
            </span>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div style={{ padding: "16px" }}>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
              <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>Generating debrief…</span>
            </div>
          )}

          {error && (
            <div style={{ color: "var(--red)", fontFamily: FONT_BODY, fontSize: "12px", padding: "8px" }}>
              {error}
            </div>
          )}

          {debrief && (
            <div className="space-y-4">
              {/* Trade meta row */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                gap: "8px",
              }}>
                {[
                  { label: "Symbol",  value: debrief.symbol },
                  { label: "Signal",  value: debrief.signal },
                  { label: "Entry",   value: `$${debrief.entry_price.toFixed(2)}` },
                  { label: "Outcome", value: outcomeLabel, color: outcomeColor },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: "var(--bg-secondary)", borderRadius: "4px",
                    padding: "8px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: FONT_MONO, marginBottom: "2px" }}>{label}</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: color ?? "var(--text-primary)", fontFamily: FONT_MONO }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* One-liner headline */}
              <div style={{
                background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: "6px", padding: "10px 12px",
              }}>
                <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.55, margin: 0 }}>
                  {debrief.one_liner}
                </p>
              </div>

              {/* Three narrative sections */}
              {[
                { title: "What Happened",      body: debrief.what_happened },
                { title: "What Was Expected",  body: debrief.what_was_expected },
                { title: "Signals & Verdict",  body: `Fired: ${debrief.signals_fired}\n\n${debrief.signals_verdict}` },
              ].map(({ title, body }) => (
                <div key={title}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-secondary)", fontFamily: FONT_MONO, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {title}
                  </p>
                  <p style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>
                    {body}
                  </p>
                </div>
              ))}

              {/* Return badge if resolved */}
              {debrief.outcome !== "pending" && debrief.outcome_price > 0 && (
                <div className="flex items-center gap-3" style={{ paddingTop: "4px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: FONT_MONO }}>5-day return:</span>
                  <span style={{
                    fontSize: "14px", fontWeight: 700, fontFamily: FONT_MONO,
                    color: debrief.return_pct >= 0 ? "var(--green)" : "var(--red)",
                  }}>
                    {debrief.return_pct >= 0 ? "+" : ""}{debrief.return_pct.toFixed(2)}%
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: FONT_MONO }}>
                    → ${debrief.outcome_price.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JournalPanel({ entries, onDebrief }: { entries: JournalEntry[]; onDebrief: (tradeId: string) => void }) {
  if (!entries.length) return (
    <div className="panel p-8 text-center">
      <BookOpen className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--text-disabled)" }} />
      <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-muted)" }}>
        No journal entries yet. Run the agent or trigger a manual cycle.
      </p>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Trade Journal</span>
        <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{entries.length} entries · newest first · click Debrief for analysis</span>
      </div>
      <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
        <table className="t-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingLeft: "12px" }}>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Amount</th>
              <th>Signal</th>
              <th>Conf.</th>
              <th style={{ textAlign: "left" }}>Reason</th>
              <th>Outcome</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td style={{ textAlign: "left", paddingLeft: "12px", color: "var(--text-muted)", fontSize: "9px", fontFamily: FONT_MONO, whiteSpace: "nowrap" }}>
                  {e.ts.slice(0, 16)}
                  {e.dry_run && <span style={{ color: "var(--blue)", marginLeft: "4px" }}>dry</span>}
                </td>
                <td className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{e.symbol}</td>
                <td><SideChip side={e.side} /></td>
                <td className="num">{e.qty > 0 ? e.qty : "—"}</td>
                <td className="num">{e.price > 0 ? `$${e.price.toFixed(2)}` : "—"}</td>
                <td className="num" style={{ color: "var(--text-secondary)" }}>
                  {e.dollar_amount > 0 ? fmt$(e.dollar_amount) : "—"}
                </td>
                <td><SignalChip signal={e.signal} /></td>
                <td className="num" style={{ color: "var(--text-secondary)" }}>
                  {e.confidence > 0 ? `${(e.confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td style={{ textAlign: "left", maxWidth: "180px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: FONT_BODY, lineHeight: 1.4 }}>
                    {e.reason}
                  </span>
                </td>
                <td>
                  {e.outcome === "win"
                    ? <span style={{ color: "var(--green)", fontSize: "10px", fontWeight: 700 }}>✓</span>
                    : e.outcome === "loss"
                    ? <span style={{ color: "var(--red)", fontSize: "10px", fontWeight: 700 }}>✗</span>
                    : e.outcome === "neutral"
                    ? <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>—</span>
                    : <span style={{ color: "var(--yellow)", fontSize: "9px" }}>⏳</span>}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {e.side !== "skip" && e.price > 0 && (
                    <button
                      onClick={() => onDebrief(e.ts)}
                      title="Post-trade debrief"
                      style={{
                        background: "none", border: "1px solid var(--border)", borderRadius: "3px",
                        padding: "2px 6px", cursor: "pointer", color: "var(--blue)",
                        fontSize: "9px", fontFamily: FONT_MONO, whiteSpace: "nowrap",
                      }}
                    >
                      Debrief
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DigestPanel({ digest, loading, onRefresh }: {
  digest: AgentDigest | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <RefreshCw className="h-5 w-5 animate-spin" style={{ color: "var(--text-muted)" }} />
      <p style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>
        Scanning all watchlist symbols… this takes ~10–30s
      </p>
    </div>
  );

  if (!digest) return (
    <div className="panel p-8 text-center">
      <Sunrise className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--text-disabled)" }} />
      <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-muted)" }}>
        Generate your morning digest to see the latest signals for your watched symbols.
      </p>
      <button onClick={onRefresh}
        className="mt-4 flex items-center gap-1.5 mx-auto px-4 py-2 text-xs font-semibold"
        style={{ background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue)44" }}>
        <Sunrise className="h-3.5 w-3.5" /> Generate Digest
      </button>
    </div>
  );

  const longs  = digest.results.filter(r => r.signal === 1  && r.actionable);
  const shorts = digest.results.filter(r => r.signal === -1 && r.actionable);
  const flat   = digest.results.filter(r => !r.actionable && !r.error);

  return (
    <div className="space-y-3">
      {/* Headline card */}
      <div className="panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sunrise className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: "var(--blue)" }} />
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
                Morning Digest — {digest.generated_at}
              </div>
              <p style={{ fontFamily: FONT_BODY, fontSize: "14px", color: "var(--text-primary)", lineHeight: 1.7 }}>
                {digest.headline}
              </p>
            </div>
          </div>
          <button onClick={onRefresh}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px]"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          {[
            { label: "Scanned", value: digest.symbols_scanned },
            { label: "LONG signals", value: digest.actionable_longs,  color: "var(--green)" },
            { label: "SHORT signals", value: digest.actionable_shorts, color: "var(--red)" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "var(--text-muted)" }}>{s.label}</div>
              <div className="text-lg font-black num" style={{ color: s.color ?? "var(--text-primary)" }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Actionable signals */}
      {(longs.length > 0 || shorts.length > 0) && (
        <div className="panel">
          <div className="panel-header">
            <span>Actionable Signals</span>
            <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>above confidence threshold</span>
          </div>
          <div className="p-3 space-y-2">
            {[...longs, ...shorts].map(r => (
              <div key={r.symbol} className="flex items-center gap-3 px-3 py-2"
                style={{ background: r.signal === 1 ? "var(--green-dim)" : "var(--red-dim)", border: `1px solid ${r.signal === 1 ? "var(--green)" : "var(--red)"}22` }}>
                <span className="font-mono font-bold w-14" style={{ color: "var(--text-primary)" }}>{r.symbol}</span>
                <SignalChip signal={r.signal} />
                <span style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-secondary)" }}>
                  {(r.confidence * 100).toFixed(0)}% conf · {r.kelly_pct.toFixed(1)}% Kelly
                </span>
                <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto" }}>
                  ${r.price.toFixed(2)} · {r.regime?.replace(/_/g, " ")}
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: "11px" }}
                  className={r.change_pct >= 0 ? "text-green-500" : "text-red-500"}>
                  {r.change_pct >= 0 ? "+" : ""}{r.change_pct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full table */}
      <div className="panel">
        <div className="panel-header">
          <span>All Watched Symbols</span>
        </div>
        <table className="t-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingLeft: "12px" }}>Symbol</th>
              <th>Price</th>
              <th>Change</th>
              <th>Signal</th>
              <th>Confidence</th>
              <th>Kelly %</th>
              <th style={{ textAlign: "left" }}>Regime</th>
            </tr>
          </thead>
          <tbody>
            {digest.results.map(r => (
              <tr key={r.symbol}>
                <td style={{ textAlign: "left", paddingLeft: "12px" }}>
                  <span className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{r.symbol}</span>
                </td>
                <td className="num">{r.price ? `$${r.price.toFixed(2)}` : "—"}</td>
                <td>
                  {r.change_pct !== undefined
                    ? <span className="num font-semibold" style={{ color: r.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                        {r.change_pct >= 0 ? "+" : ""}{r.change_pct.toFixed(2)}%
                      </span>
                    : "—"}
                </td>
                <td><SignalChip signal={r.signal ?? 0} /></td>
                <td className="num" style={{ color: (r.confidence ?? 0) >= 0.7 ? "var(--green)" : "var(--text-secondary)" }}>
                  {r.confidence ? `${(r.confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td className="num" style={{ color: "var(--text-secondary)" }}>
                  {r.kelly_pct ? `${r.kelly_pct.toFixed(1)}%` : "—"}
                </td>
                <td style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "10px", fontFamily: FONT_BODY }}>
                  {r.regime?.replace(/_/g, " ") ?? (r.error ? `Error: ${r.error}` : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function TrackRecordPanel({ record, loading, onRefresh }: {
  record: AgentTrackRecord | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3">
      <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
      <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>Loading track record…</span>
    </div>
  );

  if (!record || record.total === 0) return (
    <div className="panel p-8 text-center">
      <TrendingUp className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--text-disabled)" }} />
      <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-muted)" }}>
        No resolved outcomes yet. The agent logs each signal and resolves win/loss ~5 trading days later.
      </p>
      <p style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-disabled)", marginTop: "8px" }}>
        Run the agent in dry-run mode to start building your track record.
      </p>
      <button onClick={onRefresh} className="mt-4 flex items-center gap-1.5 mx-auto px-4 py-2 text-xs font-semibold"
        style={{ background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue)44" }}>
        <RefreshCw className="h-3 w-3" /> Check again
      </button>
    </div>
  );

  const winColor   = record.win_rate >= 60 ? "var(--green)" : record.win_rate >= 50 ? "var(--yellow)" : "var(--red)";
  const avgColor   = record.avg_return_pct >= 0 ? "var(--green)" : "var(--red)";

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Signals Resolved", value: record.total,   color: "var(--text-primary)" },
          { label: "Win Rate",         value: `${record.win_rate}%`, color: winColor },
          { label: "Wins / Losses",    value: `${record.wins} / ${record.losses}`, color: "var(--text-primary)" },
          { label: "Avg Return",       value: `${record.avg_return_pct >= 0 ? "+" : ""}${record.avg_return_pct.toFixed(2)}%`, color: avgColor },
        ].map(s => (
          <div key={s.label} className="panel p-3 text-center">
            <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 900, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <div className="panel px-4 py-3">
        <p style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {record.win_rate >= 65
            ? `Strong live track record: ${record.win_rate}% win rate on ${record.total} resolved signals. The agent's signals have demonstrated real edge on your watchlist.`
            : record.win_rate >= 55
            ? `Moderate live track record: ${record.win_rate}% accuracy on ${record.total} signals. The edge is real but not overwhelming — continue monitoring.`
            : record.win_rate >= 45
            ? `Marginal live track record: ${record.win_rate}% accuracy — near coin-flip. Consider raising the confidence threshold in Strategy Config.`
            : `Weak live track record: ${record.win_rate}% on ${record.total} signals. The agent is struggling on your watchlist — review symbols and raise confidence threshold.`}
        </p>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        <div className="panel-header">
          <span>Resolved Signal Log</span>
          <button onClick={onRefresh} style={{ color: "var(--text-muted)" }}>
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div style={{ maxHeight: "360px", overflowY: "auto" }}>
          <table className="t-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: "12px" }}>Date</th>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Entry</th>
                <th>Exit (5d)</th>
                <th>Return</th>
                <th>Outcome</th>
                <th style={{ textAlign: "left" }}>Regime</th>
              </tr>
            </thead>
            <tbody>
              {record.entries.map((e: TrackRecordEntry, i: number) => (
                <tr key={i}>
                  <td style={{ textAlign: "left", paddingLeft: "12px", color: "var(--text-muted)", fontFamily: FONT_MONO, fontSize: "10px" }}>
                    {e.ts.slice(0, 10)}
                  </td>
                  <td className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{e.symbol}</td>
                  <td>
                    {e.signal === 1
                      ? <span style={{ color: "var(--green)", fontSize: "10px", fontWeight: 700 }}>▲ LONG</span>
                      : <span style={{ color: "var(--red)", fontSize: "10px", fontWeight: 700 }}>▼ SHORT</span>}
                  </td>
                  <td className="num" style={{ fontSize: "10px" }}>${e.price.toFixed(2)}</td>
                  <td className="num" style={{ fontSize: "10px" }}>${e.outcome_price.toFixed(2)}</td>
                  <td>
                    <span className="num font-semibold" style={{ fontSize: "10px", color: e.return_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                      {e.return_pct >= 0 ? "+" : ""}{e.return_pct.toFixed(2)}%
                    </span>
                  </td>
                  <td>
                    {e.outcome === "win"
                      ? <span style={{ color: "var(--green)", fontWeight: 700, fontSize: "10px" }}>✓ Win</span>
                      : e.outcome === "loss"
                      ? <span style={{ color: "var(--red)", fontWeight: 700, fontSize: "10px" }}>✗ Loss</span>
                      : <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>— Flat</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "10px", fontFamily: FONT_BODY }}>
                    {e.regime?.replace(/_/g, " ") ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── CircuitBreakerPanel ───────────────────────────────────────────────────────

function CircuitBreakerPanel() {
  const [cb,       setCb]       = useState<CircuitBreakerStatus | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [resetting, setResetting] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [email,     setEmail]     = useState("");
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.circuitBreaker.getStatus();
      setCb(s);
      setThreshold(String(s.threshold_pct));
      setEmail(s.notify_email);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReset = async () => {
    setResetting(true);
    try {
      const s = await api.circuitBreaker.reset();
      setCb(s);
      toast("Circuit breaker reset", "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Reset failed", "error");
    } finally { setResetting(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const t = parseFloat(threshold);
      if (isNaN(t) || t < 0.5 || t > 50) {
        toast("Threshold must be between 0.5% and 50%", "error");
        return;
      }
      const s = await api.circuitBreaker.configure(t, email.trim());
      setCb(s);
      toast("Circuit breaker config saved", "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally { setSaving(false); }
  };

  const handleCheck = async () => {
    try {
      const s = await api.circuitBreaker.check();
      setCb(s);
      toast(s.tripped ? "TRIPPED — threshold exceeded" : "All clear", s.tripped ? "error" : "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Check failed", "error");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12 gap-2">
      <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
      <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>Loading…</span>
    </div>
  );

  const tripped = cb?.tripped ?? false;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div style={{
        padding: "16px 20px",
        background: tripped ? "rgba(196,30,58,0.08)" : "rgba(16,185,129,0.06)",
        border: `1px solid ${tripped ? "rgba(196,30,58,0.35)" : "rgba(16,185,129,0.3)"}`,
        display: "flex", alignItems: "center", gap: "14px",
      }}>
        {tripped
          ? <ShieldAlert className="h-7 w-7 flex-shrink-0" style={{ color: "var(--red)" }} />
          : <ShieldCheck className="h-7 w-7 flex-shrink-0" style={{ color: "var(--green)" }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
            color: tripped ? "var(--red)" : "var(--green)", marginBottom: "2px" }}>
            {tripped ? "CIRCUIT BREAKER TRIPPED" : "All Clear"}
          </div>
          {tripped ? (
            <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Account equity dropped <strong style={{ color: "var(--red)" }}>{cb?.drop_pct.toFixed(2)}%</strong> from
              prior close (${cb?.last_equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}).
              All new position entries are halted across both agents.
              {cb?.tripped_at && <span style={{ color: "var(--text-muted)" }}> Tripped {cb.tripped_at.slice(0, 16).replace("T", " ")} UTC.</span>}
            </div>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)" }}>
              Account equity is within threshold. Both agents are permitted to enter positions.
              {cb && cb.drop_pct > 0 && (
                <span> Current day drop: <strong>{cb.drop_pct.toFixed(2)}%</strong> of {cb.threshold_pct}% limit.</span>
              )}
            </div>
          )}
        </div>
        {tripped && (
          <button
            onClick={handleReset}
            disabled={resetting}
            style={{
              padding: "8px 16px", fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700,
              background: "transparent", color: "var(--red)",
              border: "1px solid var(--red)", cursor: "pointer",
              whiteSpace: "nowrap", opacity: resetting ? 0.5 : 1,
            }}
          >
            {resetting ? "Resetting…" : "Reset Breaker"}
          </button>
        )}
      </div>

      {/* Config */}
      <div className="panel">
        <div className="panel-header">
          <span>Configuration</span>
          <button onClick={handleCheck} style={{
            fontFamily: FONT_MONO, fontSize: "9px", color: "var(--blue)",
            background: "none", border: "1px solid var(--border)", padding: "2px 8px",
            cursor: "pointer",
          }}>
            Check Now
          </button>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px" }}>
              Halt threshold (% equity drop from prior close)
            </label>
            <input
              type="number" min={0.5} max={50} step={0.5} value={threshold}
              onChange={e => setThreshold(e.target.value)}
              style={{
                width: "120px", padding: "6px 10px",
                fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 700,
                color: "var(--text-primary)", background: "var(--bg-raised)",
                border: "1px solid var(--border)", outline: "none",
              }}
            />
            <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
              % (default 5.0)
            </span>
            <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
              If today's account equity drops more than this % from last night's close, both agents halt.
            </div>
          </div>
          <div>
            <label style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "6px" }}>
              Alert email (optional)
            </label>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{
                width: "100%", padding: "6px 10px",
                fontFamily: FONT_MONO, fontSize: "12px",
                color: "var(--text-primary)", background: "var(--bg-raised)",
                border: "1px solid var(--border)", outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
              One email is sent the moment the breaker trips. Leave blank to skip.
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              alignSelf: "flex-start", padding: "8px 20px",
              fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700,
              background: "var(--blue)", color: "#fff",
              border: "none", cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Config"}
          </button>
        </div>
      </div>

      {/* How it works */}
      <div style={{ padding: "12px 16px", background: "var(--bg-secondary)", borderRadius: "4px" }}>
        <p style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
          <strong style={{ color: "var(--text-secondary)" }}>How it works:</strong>{" "}
          Before each new position entry, both the swing agent and the intraday agent call Alpaca for your
          current equity balance. If equity has dropped more than the threshold from last night's close,
          all entries are blocked and you receive one alert email. Open positions are{" "}
          <em>not</em> force-closed — the breaker only prevents opening new ones.
          After reviewing the situation, click <strong>Reset Breaker</strong> to resume normal operation.
        </p>
      </div>
    </div>
  );
}


// ── Main panel ────────────────────────────────────────────────────────────────

export function AgentPanel() {
  const { onboarding } = useTrader();
  const [tab,     setTab]     = useState<PanelTab>("status");
  const [status,  setStatus]  = useState<AgentStatus | null>(null);
  const [config,  setConfig]  = useState<AgentConfig | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [digest,  setDigest]  = useState<AgentDigest | null>(null);
  const [trackRecord, setTrackRecord] = useState<AgentTrackRecord | null>(null);
  const [running,          setRunning]          = useState(false);
  const [savingConfig,     setSavingConfig]      = useState(false);
  const [digestLoading,    setDigestLoading]     = useState(false);
  const [trackRecordLoading, setTrackRecordLoading] = useState(false);
  const [debriefTradeId,   setDebriefTradeId]   = useState<string | null>(null);
  const [cbTripped,        setCbTripped]         = useState(false);

  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef        = useRef<EventSource | null>(null);
  const journalCount = useRef<number>(-1);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.agent.getStatus();
      setStatus(s);
    } catch { /* non-critical */ }
  }, []);

  const loadConfig = useCallback(async () => {
    try { setConfig(await api.agent.getConfig()); } catch { /* */ }
  }, []);

  const loadJournal = useCallback(async () => {
    try {
      const d = await api.agent.getJournal(100);
      setJournal(d.journal);
    } catch { /* */ }
  }, []);

  // Initial load
  useEffect(() => {
    loadStatus();
    loadConfig();
    loadJournal();
    api.circuitBreaker.getStatus().then(s => setCbTripped(s.tripped)).catch(() => {});
  }, [loadStatus, loadConfig, loadJournal]);

  // SSE real-time agent status — replaces polling while tab is open
  useEffect(() => {
    if (tab !== "status") return;

    const es = new EventSource("/api/agent/stream");
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const state = JSON.parse(ev.data) as AgentStatus;
        setStatus(state);
        const count = state.journal_count ?? 0;
        if (journalCount.current !== -1 && count > journalCount.current) {
          toast(`Trade fired — ${state.last_run_summary ?? "agent executed a cycle"}`, "success");
          loadJournal();
        }
        journalCount.current = count;
      } catch { /* malformed frame */ }
    };

    es.onerror = () => {
      // SSE closed or server restarted — fall back to 30s polling
      es.close();
      esRef.current = null;
      pollRef.current = setInterval(loadStatus, 30_000);
    };

    return () => {
      es.close();
      esRef.current = null;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [tab, loadStatus, loadJournal]);

  const handleRunOnce = async () => {
    setRunning(true);
    try {
      const result = await api.agent.runOnce();
      toast(result.summary, "success");
      await Promise.all([loadStatus(), loadJournal()]);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Run failed", "error");
    } finally {
      setRunning(false);
    }
  };

  const handleSaveConfig = async (updates: Partial<AgentConfig>) => {
    setSavingConfig(true);
    try {
      const saved = await api.agent.setConfig(updates);
      setConfig(saved);
      toast("Config saved", "success");
      await loadStatus();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleLoadDigest = async () => {
    setDigestLoading(true);
    try {
      const d = await api.agent.getDigest();
      setDigest(d);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Digest failed", "error");
    } finally {
      setDigestLoading(false);
    }
  };

  const handleLoadTrackRecord = async () => {
    setTrackRecordLoading(true);
    try {
      setTrackRecord(await api.agent.getTrackRecord());
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Track record failed", "error");
    } finally {
      setTrackRecordLoading(false);
    }
  };

  // Auto-load track record when tab is selected
  const handleTabChange = (t: PanelTab) => {
    setTab(t);
    if (t === "track-record" && !trackRecord && !trackRecordLoading) {
      handleLoadTrackRecord();
    }
  };

  const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: "status",          label: "Status",          icon: <Bot className="h-3 w-3" /> },
    { id: "config",          label: "Config",           icon: <Settings className="h-3 w-3" /> },
    { id: "journal",         label: "Journal",          icon: <BookOpen className="h-3 w-3" /> },
    { id: "digest",          label: "Digest",           icon: <Sunrise className="h-3 w-3" /> },
    { id: "track-record",    label: "Track Record",     icon: <TrendingUp className="h-3 w-3" /> },
    { id: "circuit-breaker", label: "Circuit Breaker",  icon: <ShieldAlert className="h-3 w-3" /> },
  ];

  return (
    <div className="space-y-3">
      {debriefTradeId && (
        <DebriefCard tradeId={debriefTradeId} onClose={() => setDebriefTradeId(null)} />
      )}

      {/* Broker-not-connected info banner */}
      {!onboarding.brokerConnected && (
        <div style={{
          display: "flex", gap: "10px", padding: "12px 16px",
          background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.3)",
        }}>
          <AlertTriangle size={14} style={{ color: "#92400E", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "#78350F", lineHeight: 1.6 }}>
            <strong>No broker connected.</strong> The agent will compute and log signals but cannot place orders.
            Dry-run mode is automatically active. Connect Alpaca in your profile to enable live or paper execution.
          </div>
        </div>
      )}
      {/* Tab bar */}
      <div className="panel">
        <div className="flex"
          style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
              style={{
                color:       tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: tab === t.id ? "2px solid var(--blue)" : "2px solid transparent",
                background:  "transparent",
                position: "relative",
              }}
            >
              {t.id === "circuit-breaker" && cbTripped && (
                <span style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: "var(--red)", display: "inline-block", flexShrink: 0,
                }} />
              )}
              {t.icon} {t.label}
            </button>
          ))}
          {/* Status indicator in header */}
          {status && (
            <div className="ml-auto flex items-center gap-1.5 px-4">
              <span className="h-1.5 w-1.5 rounded-full"
                style={{ background: status.enabled ? status.running ? "var(--green)" : "var(--yellow)" : "var(--text-disabled)" }} />
              <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                {status.enabled ? (status.running ? "Running" : "Idle") : "Off"}
              </span>
            </div>
          )}
        </div>

        <div className="p-3">
          {tab === "status"       && <StatusPanel status={status} onRunOnce={handleRunOnce} running={running} />}
          {tab === "config"       && <ConfigPanel config={config} onSave={handleSaveConfig} saving={savingConfig} />}
          {tab === "journal"      && <JournalPanel entries={journal} onDebrief={setDebriefTradeId} />}
          {tab === "digest"       && <DigestPanel digest={digest} loading={digestLoading} onRefresh={handleLoadDigest} />}
          {tab === "track-record"    && <TrackRecordPanel record={trackRecord} loading={trackRecordLoading} onRefresh={handleLoadTrackRecord} />}
          {tab === "circuit-breaker" && <CircuitBreakerPanel />}
        </div>
      </div>
    </div>
  );
}
