"use client";

import { useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { FlaskConical, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { api, type PortfolioBacktestResult, type PortfolioBacktestCurvePoint } from "@/lib/api";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

const PERIODS = ["6mo", "1y", "2y", "5y"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v: number, plusSign = true): string {
  const sign = plusSign && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtMoney(v: number): string {
  return v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
    ? `$${(v / 1_000).toFixed(1)}K`
    : `$${v.toFixed(0)}`;
}

function returnColor(v: number) {
  return v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--text-muted)";
}

function sharpeLabel(s: number): { label: string; color: string } {
  if (s >= 2.0) return { label: "Excellent", color: "var(--green)" };
  if (s >= 1.0) return { label: "Good",      color: "var(--green)" };
  if (s >= 0.5) return { label: "Moderate",  color: "var(--yellow)" };
  return { label: "Poor", color: "var(--red)" };
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CurveTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; payload: PortfolioBacktestCurvePoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "#0B1F3A",
      border: "1px solid rgba(255,255,255,0.12)",
      padding: "8px 12px",
      fontFamily: FONT_BODY,
      fontSize: 11,
    }}>
      <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 4, fontSize: 10 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 12px" }}>
        <span style={{ color: "var(--text-muted)" }}>Portfolio</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: "var(--text-primary)" }}>
          {fmtMoney(d.total)}
        </span>
        <span style={{ color: "var(--text-muted)" }}>Return</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: returnColor(d.pnl_pct) }}>
          {fmtPct(d.pnl_pct)}
        </span>
        <span style={{ color: "var(--text-muted)" }}>Drawdown</span>
        <span style={{ fontFamily: FONT_MONO, color: d.drawdown > 10 ? "var(--red)" : "var(--text-secondary)" }}>
          {d.drawdown > 0 ? `-${d.drawdown.toFixed(1)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  symbols: string[];
  totalCash: number;
}

export function PortfolioBacktestPanel({ symbols, totalCash }: Props) {
  const [data,    setData]    = useState<PortfolioBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [period,  setPeriod]  = useState("1y");

  const run = useCallback(async (p = period) => {
    if (symbols.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.portfolioBacktest(symbols, p, totalCash || 100_000);
      setData(res);
      setLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, [symbols, period, totalCash]);

  const changePeriod = (p: string) => {
    setPeriod(p);
    if (loaded) run(p);
  };

  if (symbols.length < 2) return null;

  // ── Unloaded state ─────────────────────────────────────────────────────────
  if (!loaded && !loading) {
    return (
      <div className="panel p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
              Portfolio Backtest
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              Combined equity curve for {symbols.join(", ")} with Kelly sizing — loads in ~30s
            </div>
          </div>
        </div>
        <button
          onClick={() => run()}
          style={{
            fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
            padding: "6px 14px",
            background: "transparent",
            border: "1px solid var(--blue)",
            color: "var(--blue)",
            cursor: "pointer",
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Run →
        </button>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="panel p-4 flex items-center gap-3">
        <RefreshCw className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-secondary)" }}>
            Running portfolio backtest…
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            Backtesting {symbols.length} symbols simultaneously. This takes ~{symbols.length * 6}s.
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="panel p-3 flex items-center justify-between gap-3">
        <span style={{ color: "var(--red)", fontSize: 11, fontFamily: FONT_BODY }}>{error}</span>
        <button onClick={() => run()} style={{ color: "var(--blue)", fontSize: 10, fontFamily: FONT_BODY, background: "none", border: "none", cursor: "pointer" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const curve   = data.combined_curve;
  const minVal  = Math.min(...curve.map(c => c.total));
  const maxVal  = Math.max(...curve.map(c => c.total));
  const yPad    = (maxVal - minVal) * 0.08 || 1000;
  const positiveReturn = data.total_return >= 0;
  const { label: sharpeL, color: sharpeC } = sharpeLabel(data.sharpe);

  // Thin out curve for chart performance — max 200 points
  const step   = Math.max(1, Math.floor(curve.length / 200));
  const chartData = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-1.5">
          <FlaskConical className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
          <span>Portfolio Backtest</span>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: FONT_BODY, marginLeft: 4 }}>
            {symbols.join(" · ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center" style={{ border: "1px solid var(--border)" }}>
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => changePeriod(p)}
                style={{
                  padding: "2px 8px",
                  fontFamily: FONT_BODY,
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase" as const,
                  background: period === p ? "rgba(196,30,58,0.2)" : "transparent",
                  color: period === p ? "#FFFFFF" : "var(--text-muted)",
                  border: "none",
                  cursor: "pointer",
                  borderRight: p !== "5y" ? "1px solid var(--border)" : "none",
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <button onClick={() => run()} title="Re-run" style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
            <RefreshCw className="h-3 w-3 hover:text-white transition-colors" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-4">

        {/* ── Top KPI strip ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            {
              label: "Total Return",
              value: fmtPct(data.total_return),
              color: returnColor(data.total_return),
              icon: data.total_return >= 0 ? TrendingUp : TrendingDown,
            },
            {
              label: `Alpha vs SPY (${fmtPct(data.bnh_return, true)})`,
              value: fmtPct(data.alpha),
              color: returnColor(data.alpha),
              icon: null,
            },
            {
              label: "Sharpe Ratio",
              value: `${data.sharpe.toFixed(2)} — ${sharpeL}`,
              color: sharpeC,
              icon: null,
            },
            {
              label: "Max Drawdown",
              value: `-${data.max_drawdown.toFixed(1)}%`,
              color: data.max_drawdown > 20 ? "var(--red)" : data.max_drawdown > 10 ? "var(--yellow)" : "var(--green)",
              icon: null,
            },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", padding: "10px 12px" }}>
              <div style={{ fontSize: 9, fontFamily: FONT_BODY, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                {label}
              </div>
              <div className="flex items-center gap-1.5">
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />}
                <div style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color }}>
                  {value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Combined equity curve ────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, fontFamily: FONT_BODY }}>
            Combined Portfolio Equity ({period}) — equal-weight Kelly sizing
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="pbGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={positiveReturn ? "#1A6B4A" : "#C41E3A"} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={positiveReturn ? "#1A6B4A" : "#C41E3A"} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fill: "var(--text-disabled)", fontSize: 9, fontFamily: FONT_BODY }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(v: string) => v?.slice(0, 7)}
                />
                <YAxis
                  domain={[minVal - yPad, maxVal + yPad]}
                  tick={{ fill: "var(--text-disabled)", fontSize: 9, fontFamily: FONT_MONO }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => fmtMoney(v)}
                />
                <ReTooltip content={<CurveTooltip />} />
                <ReferenceLine y={data.initial_cash} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={positiveReturn ? "#1A6B4A" : "#C41E3A"}
                  strokeWidth={1.5}
                  fill="url(#pbGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: positiveReturn ? "#1A6B4A" : "#C41E3A" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-disabled)", marginTop: 4, fontFamily: FONT_BODY }}>
            Starting capital {fmtMoney(data.initial_cash)} equally split across {data.symbols.length} symbols.
            Final portfolio value: <span style={{ fontFamily: FONT_MONO, color: returnColor(data.total_return) }}>{fmtMoney(data.final_value)}</span>
          </div>
        </div>

        {/* ── Per-symbol breakdown ─────────────────────────────────────── */}
        {data.per_symbol.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, fontFamily: FONT_BODY }}>
              Per-Symbol Performance
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  {["Symbol", "Return", "Alpha", "Sharpe", "Max DD", "Trades", "Win%"].map(h => (
                    <th key={h} style={{
                      padding: "4px 8px",
                      textAlign: h === "Symbol" ? "left" : "right",
                      fontFamily: FONT_BODY,
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.per_symbol.map((s, i) => (
                  <tr
                    key={s.symbol}
                    style={{ background: i % 2 === 0 ? "transparent" : "var(--bg-raised)" }}
                  >
                    <td style={{ padding: "5px 8px", fontFamily: FONT_MONO, fontWeight: 700, fontSize: 11, color: "var(--text-primary)" }}>
                      {s.symbol}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: returnColor(s.total_return) }}>
                      {fmtPct(s.total_return)}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: returnColor(s.alpha) }}>
                      {fmtPct(s.alpha)}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: sharpeLabel(s.sharpe).color }}>
                      {s.sharpe.toFixed(2)}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: s.max_drawdown > 20 ? "var(--red)" : "var(--text-secondary)" }}>
                      -{s.max_drawdown.toFixed(1)}%
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-secondary)" }}>
                      {s.n_trades}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: s.win_rate >= 55 ? "var(--green)" : s.win_rate >= 45 ? "var(--yellow)" : "var(--red)" }}>
                      {s.win_rate.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Relative contribution bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: FONT_BODY, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Return Contribution
              </div>
              <div style={{ display: "flex", height: 16, overflow: "hidden" }}>
                {data.per_symbol.map((s, i) => {
                  const total = data.per_symbol.reduce((acc, x) => acc + Math.max(0.01, Math.abs(x.total_return)), 0);
                  const width = (Math.abs(s.total_return) / total) * 100;
                  const colors = ["#1A6B4A", "#C41E3A", "#D4824A", "#8B6914", "#6B6B6B", "#a78bfa", "#06b6d4", "#f97316"];
                  return (
                    <div
                      key={s.symbol}
                      title={`${s.symbol}: ${fmtPct(s.total_return)}`}
                      style={{
                        width: `${width}%`,
                        background: s.total_return >= 0 ? colors[i % colors.length] : "var(--red)",
                        opacity: s.total_return >= 0 ? 0.85 : 0.5,
                        borderRight: i < data.per_symbol.length - 1 ? "1px solid var(--bg)" : "none",
                        position: "relative",
                        overflow: "hidden",
                        cursor: "default",
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
                {data.per_symbol.map((s, i) => {
                  const colors = ["#1A6B4A", "#C41E3A", "#D4824A", "#8B6914", "#6B6B6B", "#a78bfa", "#06b6d4", "#f97316"];
                  return (
                    <div key={s.symbol} className="flex items-center gap-1">
                      <div style={{ width: 8, height: 8, background: colors[i % colors.length], flexShrink: 0 }} />
                      <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: "var(--text-muted)" }}>{s.symbol}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Bottom note ───────────────────────────────────────────────── */}
        <div style={{ fontSize: 9, color: "var(--text-disabled)", fontFamily: FONT_BODY, borderTop: "1px solid var(--border)", paddingTop: 8, lineHeight: 1.6 }}>
          Backtest uses walk-forward signals with 60-bar warmup, Kelly-fractional sizing, IB-style commissions ($0.005/share),
          and ADV-scaled slippage. Past performance does not guarantee future results.
        </div>
      </div>
    </div>
  );
}
