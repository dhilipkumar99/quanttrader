"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { X, RefreshCw, TrendingUp, TrendingDown, Minus, GitCompare } from "lucide-react";
import { api } from "@/lib/api";
import type { CandlePoint, ChartCandle } from "@/lib/api";
import type { AnalysisResult } from "@/types/quant";
import { signalLabel } from "@/lib/utils";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

// Color palette — distinct, legible on off-white background
const COLORS = [
  "#0B1F3A", // navy
  "#C41E3A", // crimson
  "#1A6B4A", // green
  "#D4824A", // amber
  "#7C3AED", // violet
  "#0891B2", // teal
];

interface SymbolData {
  symbol:    string;
  analysis:  AnalysisResult | null;
  candles:   CandlePoint[];
  chartData: ChartCandle[] | null;
  loading:   boolean;
  error:     string | null;
}

// ── Miniature SVG sparkline (zero deps) ──────────────────────────────────────
function MiniSparkline({ candles, color, width = 200, height = 52 }: {
  candles: ChartCandle[] | CandlePoint[];
  color: string;
  width?: number;
  height?: number;
}) {
  const prices = (candles as Array<ChartCandle & CandlePoint>).map(c => c.close ?? c.price);
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 4;
  const W = width - pad * 2;
  const H = height - pad * 2;
  const toX = (i: number) => pad + (i / (prices.length - 1)) * W;
  const toY = (p: number) => pad + (1 - (p - min) / range) * H;
  const path = prices.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)} ${toY(p).toFixed(1)}`).join(" ");
  const areaPath = `${path} L${toX(prices.length - 1).toFixed(1)} ${(pad + H).toFixed(1)} L${pad} ${(pad + H).toFixed(1)} Z`;
  const changePct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const isUp = changePct >= 0;
  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={areaPath} fill={color} fillOpacity="0.12" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={toX(prices.length - 1)} cy={toY(prices[prices.length - 1])} r="2.5" fill={color} />
      </svg>
      <div style={{
        position: "absolute", top: 2, right: 2,
        fontSize: "9px", fontFamily: "'SF Mono', monospace",
        fontWeight: 700, color: isUp ? "#1A6B4A" : "#C41E3A",
      }}>
        {isUp ? "+" : ""}{changePct.toFixed(1)}%
      </div>
    </div>
  );
}

// Normalise candles to % return from first close
function normalise(candles: CandlePoint[]): { date: string; pct: number }[] {
  if (!candles.length) return [];
  const base = candles[0].price;
  if (!base) return [];
  return candles.map(c => ({
    date: c.date,
    pct:  +((c.price / base - 1) * 100).toFixed(3),
  }));
}

// Merge normalised series into a single array keyed by date
type TimelinePoint = { date: string } & Record<string, number>;

function mergeTimelines(
  entries: { symbol: string; series: { date: string; pct: number }[] }[]
): TimelinePoint[] {
  const byDate: Record<string, Record<string, number>> = {};
  for (const { symbol, series } of entries) {
    for (const { date, pct } of series) {
      if (!byDate[date]) byDate[date] = {};
      byDate[date][symbol] = pct;
    }
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals } as TimelinePoint));
}

// ── Signal mini-card ──────────────────────────────────────────────────────────

function SignalCard({ sd, color, onRemove }: {
  sd: SymbolData;
  color: string;
  onRemove: () => void;
}) {
  const a = sd.analysis;

  if (sd.loading) return (
    <div className="panel p-3 animate-pulse" style={{ borderTop: `3px solid ${color}` }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 900, color }}>{sd.symbol}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-disabled)", marginTop: 6 }}>Loading…</div>
    </div>
  );

  if (sd.error || !a) return (
    <div className="panel p-3" style={{ borderTop: `3px solid var(--red)` }}>
      <div className="flex items-center justify-between">
        <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 900, color: "var(--text-muted)" }}>{sd.symbol}</span>
        <button onClick={onRemove} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--red)", marginTop: 4 }}>{sd.error ?? "Failed to load"}</div>
    </div>
  );

  const sig = a.composite_signal;
  const sigColor = sig === 1 ? "var(--green)" : sig === -1 ? "var(--red)" : "var(--yellow)";
  const Icon = sig === 1 ? TrendingUp : sig === -1 ? TrendingDown : Minus;

  return (
    <div className="panel overflow-hidden" style={{ borderTop: `3px solid ${color}` }}>
      {/* Header row */}
      <div style={{ padding: "8px 12px", background: "#F8F6F2", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="flex items-center gap-2">
          <div style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
          <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 900, color: "var(--text-primary)" }}>{sd.symbol}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: "var(--text-secondary)" }}>${a.price.toFixed(2)}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: a.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
            {a.change_pct >= 0 ? "+" : ""}{a.change_pct.toFixed(2)}%
          </span>
        </div>
        <button onClick={onRemove} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}>
          <X className="h-3 w-3" />
        </button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        {/* Signal */}
        <div className="flex items-center gap-2 mb-3">
          <Icon className="h-4 w-4" style={{ color: sigColor }} strokeWidth={2.5} />
          <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: sigColor }}>
            {signalLabel(sig)}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: sigColor }}>
            {(a.composite_confidence * 100).toFixed(0)}%
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
            {a.regime.replace(/_/g, " ")}
          </span>
        </div>

        {/* Confidence bar */}
        <div style={{ height: 3, background: "var(--bg-active)", marginBottom: 10 }}>
          <div style={{ height: "100%", width: `${a.composite_confidence * 100}%`, background: sigColor, transition: "width 0.5s" }} />
        </div>

        {/* Key metrics grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {[
            { label: "Kelly %",   value: `${a.position_size_pct}%`,               color: "var(--blue)" },
            { label: "Sharpe",    value: (a.risk_metrics?.sharpe ?? 0).toFixed(2), color: (a.risk_metrics?.sharpe ?? 0) > 1 ? "var(--green)" : "var(--text-secondary)" },
            { label: "Max DD",    value: `${((a.risk_metrics?.max_drawdown ?? 0) * 100).toFixed(1)}%`, color: (a.risk_metrics?.max_drawdown ?? 0) > 0.2 ? "var(--red)" : "var(--text-secondary)" },
            { label: "RSI",       value: (a.indicators?.rsi_14 ?? 50).toFixed(0), color: (a.indicators?.rsi_14 ?? 50) > 70 ? "var(--red)" : (a.indicators?.rsi_14 ?? 50) < 30 ? "var(--green)" : "var(--text-secondary)" },
            { label: "Hurst",     value: (a.indicators?.hurst ?? 0.5).toFixed(2), color: (a.indicators?.hurst ?? 0.5) > 0.6 ? "var(--green)" : "var(--yellow)" },
            { label: "Exp. Ret",  value: `${a.expected_return > 0 ? "+" : ""}${a.expected_return.toFixed(1)}%`, color: a.expected_return > 0 ? "var(--green)" : "var(--red)" },
          ].map(({ label, value, color: c }) => (
            <div key={label} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", padding: "5px 7px" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: c }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Sub-signals */}
        {a.signals.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
            {a.signals.map(s => {
              const sc = s.direction === 1 ? "var(--green)" : s.direction === -1 ? "var(--red)" : "var(--yellow)";
              const srcLabel: Record<string, string> = {
                mean_reversion: "Mean Rev",
                trend_follow:   "Trend",
                momentum:       "Momentum",
                ml_gbm:         "ML/GBM",
              };
              return (
                <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", width: 60, flexShrink: 0 }}>
                    {srcLabel[s.source] ?? s.source}
                  </span>
                  <div style={{ flex: 1, height: 4, background: "var(--bg-active)" }}>
                    <div style={{ height: "100%", width: `${s.confidence * 100}%`, background: sc }} />
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: sc, width: 28, textAlign: "right" }}>
                    {(s.confidence * 100).toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 9, color: sc }}>{s.direction === 1 ? "▲" : s.direction === -1 ? "▼" : "■"}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Price sparkline — 3-month from TwelveData cache or yfinance candles */}
        {(sd.chartData && sd.chartData.length >= 2) || sd.candles.length >= 2 ? (
          <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
              Price — 3mo
            </div>
            <MiniSparkline
              candles={sd.chartData ?? sd.candles}
              color={color}
              width={260}
              height={56}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Tooltip for overlay chart ─────────────────────────────────────────────────

function OverlayTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div style={{
      background: "#0B1F3A",
      border: "1px solid rgba(255,255,255,0.12)",
      padding: "8px 12px",
      fontFamily: FONT_BODY,
      fontSize: 11,
    }}>
      <div style={{ color: "rgba(255,255,255,0.45)", marginBottom: 5, fontSize: 10 }}>{label}</div>
      {sorted.map(p => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <div style={{ width: 8, height: 8, background: p.color, flexShrink: 0 }} />
          <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: "#FFFFFF", width: 44 }}>{p.name}</span>
          <span style={{ fontFamily: FONT_MONO, color: p.value >= 0 ? "#1A6B4A" : "#C41E3A", fontWeight: 600 }}>
            {p.value >= 0 ? "+" : ""}{p.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  initialSymbols?: string[];
  period: string;
}

export function ComparisonPanel({ initialSymbols = [], period }: Props) {
  const [entries, setEntries] = useState<SymbolData[]>([]);
  const [input, setInput]     = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchOne = useCallback(async (sym: string): Promise<SymbolData> => {
    try {
      const [analysis, candleRes, chartRes] = await Promise.all([
        api.analyze(sym, period),
        api.candles(sym, period).catch(() => ({ candles: [] as CandlePoint[] })),
        api.charts.forSymbol(sym, "3mo").catch(() => null),
      ]);
      return { symbol: sym, analysis, candles: candleRes.candles, chartData: chartRes?.candles ?? null, loading: false, error: null };
    } catch (e: unknown) {
      return { symbol: sym, analysis: null, candles: [], chartData: null, loading: false, error: e instanceof Error ? e.message : "Failed" };
    }
  }, [period]);

  // Load initial symbols
  useEffect(() => {
    if (!initialSymbols.length) return;
    const initial = initialSymbols.map(s => ({
      symbol: s, analysis: null, candles: [], chartData: null, loading: true, error: null,
    }));
    setEntries(initial);
    initialSymbols.forEach(async (sym) => {
      const data = await fetchOne(sym);
      setEntries(prev => prev.map(e => e.symbol === sym ? data : e));
    });
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSymbolByName = useCallback(async (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s || entries.some(e => e.symbol === s) || entries.length >= 6) return;
    setEntries(prev => [...prev, { symbol: s, analysis: null, candles: [], chartData: null, loading: true, error: null }]);
    const data = await fetchOne(s);
    setEntries(prev => prev.map(e => e.symbol === s ? data : e));
  }, [entries, fetchOne]);

  const addSymbol = useCallback(async () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setInput("");
    await addSymbolByName(sym);
  }, [input, addSymbolByName]);

  const removeSymbol = useCallback((sym: string) => {
    setEntries(prev => prev.filter(e => e.symbol !== sym));
  }, []);

  const refreshAll = useCallback(async () => {
    const syms = entries.map(e => e.symbol);
    setEntries(prev => prev.map(e => ({ ...e, loading: true, error: null })));
    await Promise.all(syms.map(async (sym) => {
      const data = await fetchOne(sym);
      setEntries(prev => prev.map(e => e.symbol === sym ? data : e));
    }));
  }, [entries, fetchOne]);

  // Build overlay chart data
  const normEntries = entries
    .filter(e => e.candles.length > 0)
    .map((e, i) => ({ symbol: e.symbol, color: COLORS[i % COLORS.length], series: normalise(e.candles) }));

  // Thin the timeline to max 150 points for chart performance
  const merged = mergeTimelines(normEntries);
  const step = Math.max(1, Math.floor(merged.length / 150));
  const chartData = merged.filter((_, i) => i % step === 0 || i === merged.length - 1);

  // Rank by total return over period
  const ranked = [...entries]
    .filter(e => e.candles.length > 0)
    .map((e, i) => {
      const series = normalise(e.candles);
      const ret = series.length ? series[series.length - 1].pct : 0;
      return { symbol: e.symbol, ret, color: COLORS[entries.indexOf(e) % COLORS.length] };
    })
    .sort((a, b) => b.ret - a.ret);

  return (
    <div className="space-y-3">
      {/* Header / controls */}
      <div className="panel p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Compare Symbols
            </span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-disabled)" }}>
              up to 6
            </span>
          </div>

          {/* Add symbol input */}
          {entries.length < 6 && (
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex items-center" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && addSymbol()}
                  placeholder="Add symbol…"
                  maxLength={6}
                  style={{
                    width: 110,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "5px 8px",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    outline: "none",
                    textTransform: "uppercase",
                  }}
                  onFocus={e => (e.currentTarget.parentElement!.style.borderColor = "var(--red)")}
                  onBlur={e => (e.currentTarget.parentElement!.style.borderColor = "var(--border)")}
                />
                <button
                  onClick={addSymbol}
                  disabled={!input.trim()}
                  style={{
                    padding: "5px 10px",
                    background: input.trim() ? "var(--navy)" : "var(--bg-raised)",
                    color: input.trim() ? "#FFFFFF" : "var(--text-disabled)",
                    border: "none",
                    cursor: input.trim() ? "pointer" : "not-allowed",
                    fontFamily: FONT_BODY,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    borderLeft: "1px solid var(--border)",
                  }}
                >
                  Add
                </button>
              </div>
              {entries.length > 0 && (
                <button onClick={refreshAll} title="Refresh all" style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Quick-add suggestions */}
        {entries.length === 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-disabled)", alignSelf: "center" }}>Suggestions:</span>
            {["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA"].map(s => (
              <button
                key={s}
                onClick={() => addSymbolByName(s)}
                style={{
                  fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
                  padding: "3px 8px",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {entries.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-disabled)", lineHeight: 2 }}>
          Add 2–6 symbols to compare their signals, indicators, and price performance side-by-side.
        </div>
      )}

      {/* Normalised price overlay chart */}
      {chartData.length > 0 && normEntries.length >= 2 && (
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <span>Normalised Price Performance ({period})</span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-disabled)" }}>
              % return from period start
            </span>
          </div>
          <div style={{ padding: "12px 12px 4px" }}>
            {/* Return ranking strip */}
            {ranked.length > 0 && (
              <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                {ranked.map((r, i) => (
                  <div key={r.symbol} className="flex items-center gap-1.5">
                    <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: "var(--text-disabled)" }}>#{i + 1}</span>
                    <div style={{ width: 8, height: 8, background: r.color }} />
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{r.symbol}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: r.ret >= 0 ? "var(--green)" : "var(--red)" }}>
                      {r.ret >= 0 ? "+" : ""}{r.ret.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--text-disabled)", fontSize: 9, fontFamily: FONT_BODY }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    tickFormatter={(v: string) => v?.slice(0, 7)}
                  />
                  <YAxis
                    tick={{ fill: "var(--text-disabled)", fontSize: 9, fontFamily: FONT_MONO }}
                    tickLine={false}
                    axisLine={false}
                    width={46}
                    tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                  />
                  <ReferenceLine y={0} stroke="rgba(0,0,0,0.12)" strokeDasharray="3 4" />
                  <ReTooltip content={<OverlayTooltip />} />
                  <Legend
                    formatter={(val) => <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: "var(--text-secondary)" }}>{val}</span>}
                    wrapperStyle={{ paddingTop: 6 }}
                  />
                  {normEntries.map(({ symbol, color }) => (
                    <Line
                      key={symbol}
                      type="monotone"
                      dataKey={symbol}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Signal cards grid */}
      {entries.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: entries.length === 1
              ? "1fr"
              : entries.length <= 2
              ? "repeat(2, 1fr)"
              : entries.length <= 4
              ? "repeat(2, 1fr)"
              : "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {entries.map((sd, i) => (
            <SignalCard
              key={sd.symbol}
              sd={sd}
              color={COLORS[i % COLORS.length]}
              onRemove={() => removeSymbol(sd.symbol)}
            />
          ))}
        </div>
      )}

      {/* Indicators comparison table */}
      {entries.filter(e => e.analysis).length >= 2 && (
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <span>Indicators Side-by-Side</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ padding: "6px 12px", textAlign: "left", fontFamily: FONT_BODY, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", background: "#F8F6F2" }}>
                    Indicator
                  </th>
                  {entries.filter(e => e.analysis).map((e, i) => (
                    <th key={e.symbol} style={{ padding: "6px 12px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, fontWeight: 900, color: COLORS[entries.indexOf(e) % COLORS.length], borderBottom: "1px solid var(--border)", background: "#F8F6F2" }}>
                      {e.symbol}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Signal",
                    fmt: (a: AnalysisResult) => signalLabel(a.composite_signal),
                    color: (a: AnalysisResult) => a.composite_signal === 1 ? "var(--green)" : a.composite_signal === -1 ? "var(--red)" : "var(--yellow)",
                  },
                  {
                    label: "Confidence",
                    fmt: (a: AnalysisResult) => `${(a.composite_confidence * 100).toFixed(0)}%`,
                    color: (a: AnalysisResult) => a.composite_confidence > 0.7 ? "var(--green)" : a.composite_confidence > 0.55 ? "var(--yellow)" : "var(--text-secondary)",
                  },
                  {
                    label: "RSI (14)",
                    fmt: (a: AnalysisResult) => (a.indicators?.rsi_14 ?? 0).toFixed(0),
                    color: (a: AnalysisResult) => {
                      const v = a.indicators?.rsi_14 ?? 50;
                      return v > 70 ? "var(--red)" : v < 30 ? "var(--green)" : "var(--text-secondary)";
                    },
                  },
                  {
                    label: "Sharpe",
                    fmt: (a: AnalysisResult) => (a.risk_metrics?.sharpe ?? 0).toFixed(2),
                    color: (a: AnalysisResult) => (a.risk_metrics?.sharpe ?? 0) > 1 ? "var(--green)" : "var(--text-secondary)",
                  },
                  {
                    label: "Max DD",
                    fmt: (a: AnalysisResult) => `-${((a.risk_metrics?.max_drawdown ?? 0) * 100).toFixed(1)}%`,
                    color: (a: AnalysisResult) => (a.risk_metrics?.max_drawdown ?? 0) > 0.2 ? "var(--red)" : "var(--text-secondary)",
                  },
                  {
                    label: "Kelly %",
                    fmt: (a: AnalysisResult) => `${a.position_size_pct}%`,
                    color: (a: AnalysisResult) => a.composite_signal !== 0 ? "var(--blue)" : "var(--text-muted)",
                  },
                  {
                    label: "Hurst",
                    fmt: (a: AnalysisResult) => (a.indicators?.hurst ?? 0.5).toFixed(2),
                    color: (a: AnalysisResult) => {
                      const h = a.indicators?.hurst ?? 0.5;
                      return h > 0.6 ? "var(--green)" : h < 0.4 ? "var(--yellow)" : "var(--text-secondary)";
                    },
                  },
                  {
                    label: "Vol / ADV",
                    fmt: (a: AnalysisResult) => `${(a.indicators?.vol_adv_ratio ?? 1).toFixed(2)}×`,
                    color: (a: AnalysisResult) => (a.indicators?.vol_adv_ratio ?? 1) > 2 ? "var(--yellow)" : "var(--text-secondary)",
                  },
                  {
                    label: "Exp. Return",
                    fmt: (a: AnalysisResult) => `${a.expected_return > 0 ? "+" : ""}${a.expected_return.toFixed(1)}%`,
                    color: (a: AnalysisResult) => a.expected_return > 0 ? "var(--green)" : "var(--red)",
                  },
                  {
                    label: "MC Prob+",
                    fmt: (a: AnalysisResult) => `${a.monte_carlo?.prob_positive ?? 0}%`,
                    color: (a: AnalysisResult) => (a.monte_carlo?.prob_positive ?? 0) > 60 ? "var(--green)" : (a.monte_carlo?.prob_positive ?? 0) > 45 ? "var(--yellow)" : "var(--red)",
                  },
                  {
                    label: "Regime",
                    fmt: (a: AnalysisResult) => a.regime.replace(/_/g, " "),
                    color: () => "var(--text-secondary)",
                  },
                ].map((row, ri) => (
                  <tr key={row.label} style={{ background: ri % 2 === 0 ? "transparent" : "var(--bg-raised)" }}>
                    <td style={{ padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                      {row.label}
                    </td>
                    {entries.filter(e => e.analysis).map(e => (
                      <td key={e.symbol} style={{ padding: "6px 12px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: row.color(e.analysis!), borderBottom: "1px solid var(--border)" }}>
                        {row.fmt(e.analysis!)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
