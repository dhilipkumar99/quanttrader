"use client";

import { useState, useCallback } from "react";
import { api, type SignalHistory, type SignalHistoryRecord } from "@/lib/api";
import { RefreshCw, History, TrendingUp, TrendingDown, Minus } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

function OutcomePip({ outcome }: { outcome: SignalHistoryRecord["outcome"] }) {
  const cfg = {
    win:     { color: "var(--green)",       label: "✓ Win" },
    loss:    { color: "var(--red)",         label: "✗ Loss" },
    neutral: { color: "var(--text-muted)",  label: "— Flat" },
  }[outcome];
  return (
    <span style={{ color: cfg.color, fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700 }}>
      {cfg.label}
    </span>
  );
}

function SignalIcon({ signal }: { signal: number }) {
  if (signal === 1)  return <TrendingUp  className="h-3 w-3 inline" style={{ color: "var(--green)" }} />;
  if (signal === -1) return <TrendingDown className="h-3 w-3 inline" style={{ color: "var(--red)" }} />;
  return <Minus className="h-3 w-3 inline" style={{ color: "var(--text-muted)" }} />;
}

// Spark-style win/loss strip
function WinStrip({ records }: { records: SignalHistoryRecord[] }) {
  const active = records.filter(r => r.signal !== 0);
  if (!active.length) return null;
  return (
    <div className="flex gap-0.5 items-center flex-wrap">
      {active.map((r, i) => (
        <div key={i} title={`${r.date}: ${r.outcome}`}
          style={{
            width: 10, height: 10,
            background: r.outcome === "win" ? "var(--green)" :
                        r.outcome === "loss" ? "var(--red)" : "var(--bg-active)",
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

interface Props {
  symbol: string;
  period: string;
}

export function SignalHistoryPanel({ symbol, period }: Props) {
  const [data,    setData]    = useState<SignalHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.signalHistory(symbol, period);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [symbol, period]);

  // Show the load trigger until first load
  if (!data && !loading && !error) {
    return (
      <div className="panel p-3">
        <button
          onClick={load}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)" }}>
              Signal Track Record — {symbol}
            </span>
            <span style={{ fontSize: "9px", color: "var(--text-disabled)", fontFamily: FONT_BODY }}>
              (loads ~15s)
            </span>
          </div>
          <span style={{ fontSize: "10px", color: "var(--blue)" }}>Load →</span>
        </button>
      </div>
    );
  }

  if (loading) return (
    <div className="panel p-4 flex items-center gap-3">
      <RefreshCw className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)" }}>
          Running walk-forward signal history…
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-disabled)", marginTop: 2 }}>
          Re-analyzes {symbol} at each point in the {period} window — this takes 10–25s
        </div>
      </div>
    </div>
  );

  if (error) return (
    <div className="panel p-3 flex items-center justify-between">
      <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--red)" }}>
        {error}
      </span>
      <button onClick={load} style={{ color: "var(--blue)", fontSize: "10px" }}>Retry</button>
    </div>
  );

  if (!data) return null;

  const activeRecords = data.records.filter(r => r.signal !== 0);
  const accuracy = data.win_rate;
  const accuracyColor = accuracy >= 60 ? "var(--green)" : accuracy >= 50 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <History className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
          <span>Signal Track Record — {symbol}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            {[
              { label: "Signals", value: data.total },
              { label: "Wins",    value: data.wins,   color: "var(--green)" },
              { label: "Losses",  value: data.losses, color: "var(--red)" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 700, color: s.color ?? "var(--text-primary)" }}>
                  {s.value}
                </div>
              </div>
            ))}
            <div className="text-center px-2 py-1"
              style={{ background: accuracy >= 60 ? "var(--green-dim)" : accuracy >= 50 ? "var(--yellow-dim)" : "var(--red-dim)", border: `1px solid ${accuracyColor}44` }}>
              <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Accuracy</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: "16px", fontWeight: 900, color: accuracyColor }}>{accuracy}%</div>
            </div>
          </div>
          <button onClick={load} style={{ color: "var(--text-muted)" }} title="Reload">
            <RefreshCw className="h-3 w-3 hover:text-white transition-colors" />
          </button>
        </div>
      </div>

      {/* Win strip */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" }}>
        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: "6px", fontFamily: FONT_BODY }}>
          Recent signal outcomes (green = win, red = loss, grey = flat)
        </div>
        <WinStrip records={data.records} />
      </div>

      {/* Verdict */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <p style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {accuracy >= 65
            ? `Strong track record: ${accuracy}% of ${data.total} directional signals were correct over the past ${period}. The model has demonstrated consistent edge on ${symbol}.`
            : accuracy >= 55
            ? `Moderate track record: ${accuracy}% accuracy on ${data.total} signals. Edge exists but is not overwhelming — use Kelly sizing conservatively.`
            : accuracy >= 45
            ? `Marginal track record: ${accuracy}% accuracy on ${data.total} signals — near coin-flip. Consider waiting for higher-confidence setups before acting.`
            : `Weak track record: only ${accuracy}% accuracy on ${data.total} signals. The model has struggled on ${symbol} in this period. Do not trade with real capital until the strategy improves.`}
        </p>
      </div>

      {/* Table */}
      <div style={{ maxHeight: "240px", overflowY: "auto" }}>
        <table className="t-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingLeft: "12px" }}>Date</th>
              <th>Signal</th>
              <th>Conf.</th>
              <th>Price</th>
              <th>10-day Return</th>
              <th>Outcome</th>
              <th style={{ textAlign: "left" }}>Regime</th>
            </tr>
          </thead>
          <tbody>
            {[...data.records].reverse().map((r, i) => (
              <tr key={i} style={{ opacity: r.signal === 0 ? 0.5 : 1 }}>
                <td style={{ textAlign: "left", paddingLeft: "12px", color: "var(--text-muted)", fontFamily: FONT_MONO, fontSize: "10px" }}>
                  {r.date}
                </td>
                <td>
                  <span className="flex items-center justify-center gap-1">
                    <SignalIcon signal={r.signal} />
                    <span style={{ fontSize: "10px", fontWeight: 700,
                      color: r.signal === 1 ? "var(--green)" : r.signal === -1 ? "var(--red)" : "var(--text-muted)" }}>
                      {r.signal === 1 ? "LONG" : r.signal === -1 ? "SHORT" : "FLAT"}
                    </span>
                  </span>
                </td>
                <td className="num" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
                  {r.signal !== 0 ? `${(r.confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td className="num" style={{ fontSize: "10px" }}>${r.price.toFixed(2)}</td>
                <td>
                  <span className="num font-semibold" style={{
                    fontSize: "10px",
                    color: r.fwd_return >= 0 ? "var(--green)" : "var(--red)",
                  }}>
                    {r.fwd_return >= 0 ? "+" : ""}{r.fwd_return.toFixed(2)}%
                  </span>
                </td>
                <td>
                  {r.signal !== 0 ? <OutcomePip outcome={r.outcome} /> :
                    <span style={{ color: "var(--text-disabled)", fontSize: "10px" }}>—</span>}
                </td>
                <td style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "10px", fontFamily: FONT_BODY }}>
                  {r.regime?.replace(/_/g, " ") ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
