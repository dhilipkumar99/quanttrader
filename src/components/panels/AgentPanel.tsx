"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AgentConfig, type AgentStatus, type JournalEntry, type AgentDigest } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  Bot, Play, Square, RefreshCw, Settings, BookOpen,
  Sunrise, AlertTriangle, CheckCircle, Clock, Zap,
  ChevronDown, ChevronUp, Plus, X,
} from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type PanelTab = "status" | "config" | "journal" | "digest";

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
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Trades Logged",  value: status.journal_count, icon: <BookOpen className="h-3 w-3" /> },
          { label: "Mode",           value: status.dry_run ? "Dry Run" : "Live Orders", icon: <Zap className="h-3 w-3" /> },
          { label: "Agent Status",   value: status.running ? "Running" : "Idle", icon: <Clock className="h-3 w-3" /> },
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
  const [local, setLocal] = useState<AgentConfig | null>(null);
  const [symInput, setSymInput] = useState("");

  useEffect(() => {
    if (config && !local) setLocal({ ...config });
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
          <button
            onClick={() => onSave(local)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green)44" }}
          >
            {saving ? <><RefreshCw className="h-3 w-3 animate-spin" />Saving…</> : <><CheckCircle className="h-3 w-3" />Save Config</>}
          </button>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              { key: "min_confidence" as const, label: "Min Confidence", desc: "0–1. Only trade signals above this threshold.", min: 0.5, max: 0.99, step: 0.01, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
              { key: "kelly_cap_pct"  as const, label: "Kelly Cap %",    desc: "Hard cap: never risk more than X% of portfolio per trade.", min: 1, max: 50, step: 0.5, fmt: (v: number) => `${v}%` },
              { key: "poll_interval_min" as const, label: "Poll Interval", desc: "Minutes between automatic scan cycles.", min: 5, max: 240, step: 5, fmt: (v: number) => `${v} min` },
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

function JournalPanel({ entries }: { entries: JournalEntry[] }) {
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
        <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{entries.length} entries · newest first</span>
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
                <td style={{ textAlign: "left", maxWidth: "240px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: FONT_BODY, lineHeight: 1.4 }}>
                    {e.reason}
                  </span>
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


// ── Main panel ────────────────────────────────────────────────────────────────

export function AgentPanel() {
  const [tab,     setTab]     = useState<PanelTab>("status");
  const [status,  setStatus]  = useState<AgentStatus | null>(null);
  const [config,  setConfig]  = useState<AgentConfig | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [digest,  setDigest]  = useState<AgentDigest | null>(null);
  const [running,       setRunning]       = useState(false);
  const [savingConfig,  setSavingConfig]  = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  }, [loadStatus, loadConfig, loadJournal]);

  // Poll status every 10s while on status tab
  useEffect(() => {
    if (tab !== "status") return;
    pollRef.current = setInterval(loadStatus, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [tab, loadStatus]);

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

  const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: "status",  label: "Status",        icon: <Bot className="h-3 w-3" /> },
    { id: "config",  label: "Strategy Config", icon: <Settings className="h-3 w-3" /> },
    { id: "journal", label: "Trade Journal",  icon: <BookOpen className="h-3 w-3" /> },
    { id: "digest",  label: "Morning Digest", icon: <Sunrise className="h-3 w-3" /> },
  ];

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="panel">
        <div className="flex"
          style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
              style={{
                color:       tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: tab === t.id ? "2px solid var(--blue)" : "2px solid transparent",
                background:  "transparent",
              }}
            >
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
          {tab === "status"  && <StatusPanel status={status} onRunOnce={handleRunOnce} running={running} />}
          {tab === "config"  && <ConfigPanel config={config} onSave={handleSaveConfig} saving={savingConfig} />}
          {tab === "journal" && <JournalPanel entries={journal} />}
          {tab === "digest"  && (
            <DigestPanel digest={digest} loading={digestLoading} onRefresh={handleLoadDigest} />
          )}
        </div>
      </div>
    </div>
  );
}
