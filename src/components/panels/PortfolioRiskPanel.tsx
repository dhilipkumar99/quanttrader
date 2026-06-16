"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, RefreshCw, Shield } from "lucide-react";
import { api } from "@/lib/api";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

interface CorrelationMatrix {
  symbols: string[];
  values: number[][];
}

interface PairCorr {
  a: string;
  b: string;
  corr: number;
}

interface PortfolioRisk {
  symbols: string[];
  period: string;
  avg_corr: number;
  max_pairwise_corr: number;
  diversification_score: number;
  pairs: PairCorr[];
  corr_matrix: CorrelationMatrix;
  betas: Record<string, number>;
  warnings: string[];
}

function corrColor(c: number): string {
  const abs = Math.abs(c);
  if (abs > 0.85) return c > 0 ? "#C41E3A" : "#0B1F3A";
  if (abs > 0.65) return c > 0 ? "#D4824A" : "#1A6B4A";
  if (abs > 0.40) return "#8B6914";
  return "#6B6B6B";
}

function corrBg(c: number): string {
  const abs = Math.abs(c);
  const sign = c >= 0 ? 1 : -1;
  // Red for positive, blue-ish for negative
  const intensity = Math.min(abs * 0.9, 0.85);
  if (sign > 0) return `rgba(196,30,58,${intensity * 0.25})`;
  return `rgba(11,31,58,${intensity * 0.2})`;
}

function DivScore({ score }: { score: number }) {
  const color = score >= 70 ? "var(--green)" : score >= 45 ? "var(--yellow)" : "var(--red)";
  const label = score >= 70 ? "Well Diversified" : score >= 45 ? "Moderate Concentration" : "Highly Concentrated";
  return (
    <div className="text-center">
      <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 4 }}>
        Diversification Score
      </div>
      {/* Arc-style gauge */}
      <div className="relative inline-flex items-center justify-center" style={{ width: 80, height: 80 }}>
        <svg viewBox="0 0 80 80" style={{ position: "absolute", inset: 0 }}>
          <circle cx="40" cy="40" r="32" fill="none" stroke="var(--bg-active)" strokeWidth="7" />
          <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${(score / 100) * 201} 201`}
            strokeLinecap="square"
            transform="rotate(-90 40 40)" />
        </svg>
        <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 900, color, zIndex: 1 }}>
          {score.toFixed(0)}
        </div>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color, fontWeight: 600, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

interface Props {
  symbols: string[];
  period?: string;
}

export function PortfolioRiskPanel({ symbols, period = "1y" }: Props) {
  const [data,    setData]    = useState<PortfolioRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (symbols.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.portfolioRisk(symbols, period);
      setData(result as PortfolioRisk);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [symbols, period]);

  // Auto-load when symbols list changes and has ≥2 entries
  useEffect(() => {
    if (symbols.length >= 2) load();
  }, [load, symbols.length]);

  if (symbols.length < 2) return null;

  if (loading) return (
    <div className="panel p-4 flex items-center gap-3">
      <RefreshCw className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
      <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)" }}>
        Computing correlation matrix…
      </span>
    </div>
  );

  if (error) return (
    <div className="panel p-3 flex items-center justify-between">
      <span style={{ color: "var(--red)", fontSize: "11px" }}>{error}</span>
      <button onClick={load} style={{ color: "var(--blue)", fontSize: "10px" }}>Retry</button>
    </div>
  );

  if (!data) return null;

  const mat = data.corr_matrix;

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-1.5">
          <Shield className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
          <span>Portfolio Risk Analysis</span>
        </div>
        <button onClick={load} style={{ color: "var(--text-muted)" }} title="Refresh">
          <RefreshCw className="h-3 w-3 hover:text-white transition-colors" />
        </button>
      </div>

      <div className="p-3 space-y-4">

        {/* Warnings */}
        {data.warnings.length > 0 && (
          <div className="space-y-1.5">
            {data.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs"
                style={{ background: "var(--yellow-dim)", border: "1px solid var(--yellow)44", color: "var(--yellow)" }}>
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span style={{ fontFamily: FONT_BODY }}>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">

          {/* Diversification gauge */}
          <DivScore score={data.diversification_score} />

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            {[
              { label: "Avg Correlation",  value: `${(data.avg_corr * 100).toFixed(0)}%`,  bad: data.avg_corr > 0.6 },
              { label: "Max Pair Corr",    value: `${(data.max_pairwise_corr * 100).toFixed(0)}%`, bad: data.max_pairwise_corr > 0.8 },
              ...Object.entries(data.betas).slice(0, 4).map(([sym, b]) => ({
                label: `β ${sym}/SPY`,
                value: b.toFixed(2),
                bad: b > 1.5,
              })),
            ].map(s => (
              <div key={s.label} className="px-3 py-2"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 2, fontFamily: FONT_BODY }}>
                  {s.label}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "14px", fontWeight: 700,
                  color: s.bad ? "var(--red)" : "var(--text-primary)" }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Correlation matrix heatmap */}
        {mat.symbols.length >= 2 && (
          <div>
            <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase",
              letterSpacing: "0.14em", marginBottom: 8, fontFamily: FONT_BODY }}>
              Correlation Matrix ({data.period})
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "3px 8px", color: "var(--text-muted)", fontWeight: 600, textAlign: "right", fontFamily: FONT_BODY, fontSize: 9 }} />
                    {mat.symbols.map(s => (
                      <th key={s} style={{ padding: "3px 8px", color: "var(--text-muted)", fontWeight: 600,
                        fontFamily: FONT_MONO, fontSize: 10, textAlign: "center", letterSpacing: "0.05em" }}>
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mat.symbols.map((rowSym, ri) => (
                    <tr key={rowSym}>
                      <td style={{ padding: "3px 8px", fontFamily: FONT_MONO, fontSize: 10,
                        color: "var(--text-muted)", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>
                        {rowSym}
                      </td>
                      {mat.values[ri].map((v, ci) => (
                        <td key={ci} style={{
                          padding: "4px 8px",
                          background: ri === ci ? "var(--bg-active)" : corrBg(v),
                          textAlign: "center",
                          fontFamily: FONT_MONO, fontSize: 11, fontWeight: ri === ci ? 700 : 500,
                          color: ri === ci ? "var(--text-muted)" : corrColor(v),
                          border: "1px solid var(--border)",
                          minWidth: 52,
                        }}>
                          {ri === ci ? "—" : v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: "9px", color: "var(--text-disabled)", marginTop: 6, fontFamily: FONT_BODY }}>
              Pearson correlation on daily returns. Red = high positive correlation (concentrated risk). &gt;0.85 = near-duplicate exposure.
            </div>
          </div>
        )}

        {/* Pair list */}
        {data.pairs.length > 0 && (
          <div>
            <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase",
              letterSpacing: "0.14em", marginBottom: 6, fontFamily: FONT_BODY }}>
              Highest Correlated Pairs
            </div>
            <div className="space-y-1">
              {[...data.pairs].sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)).slice(0, 5).map(p => (
                <div key={`${p.a}-${p.b}`} className="flex items-center gap-3 px-3 py-1.5"
                  style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-primary)", fontWeight: 600, minWidth: 80 }}>
                    {p.a} / {p.b}
                  </span>
                  {/* Bar */}
                  <div className="flex-1 h-1.5" style={{ background: "var(--bg-active)" }}>
                    <div style={{
                      width: `${Math.abs(p.corr) * 100}%`,
                      height: "100%",
                      background: corrColor(p.corr),
                    }} />
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: corrColor(p.corr), minWidth: 40, textAlign: "right" }}>
                    {p.corr >= 0 ? "+" : ""}{(p.corr * 100).toFixed(0)}%
                  </span>
                  {Math.abs(p.corr) > 0.8 && (
                    <span style={{ fontSize: "9px", color: "var(--yellow)", fontFamily: FONT_BODY }}>⚠ concentrated</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
