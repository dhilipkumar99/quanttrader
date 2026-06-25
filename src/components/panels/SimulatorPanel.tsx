"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EquityChart } from "@/components/charts/EquityChart";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { fmt, fmtPct, fmtMoney } from "@/lib/utils";
import type { BacktestResult } from "@/types/quant";
import { api, type StressTestResult, type RegimeResult } from "@/lib/api";
import { FlaskConical, AlertTriangle, Timer, BookOpen, Shield, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";

// Benchmarks for plain-English comparison
const SHARPE_LABELS = [
  { threshold: 2.0,  tier: "Exceptional",  note: "better than most hedge funds" },
  { threshold: 1.5,  tier: "Excellent",    note: "top-quartile institutional performance" },
  { threshold: 1.0,  tier: "Good",         note: "above-average, suitable for real capital" },
  { threshold: 0.5,  tier: "Marginal",     note: "roughly in line with passive SPY investing" },
  { threshold: 0.0,  tier: "Below average",note: "underperforms on a risk-adjusted basis" },
  { threshold: -Infinity, tier: "Poor",    note: "returns don't justify the volatility taken" },
];

function sharpeLabel(s: number) {
  return SHARPE_LABELS.find(b => s >= b.threshold) ?? SHARPE_LABELS[SHARPE_LABELS.length - 1];
}

function ddNote(ddPct: number, cash: number) {
  const dollar = (cash * ddPct / 100).toFixed(0);
  if (ddPct < 5)   return `only ${ddPct.toFixed(1)}% — very mild. On $${Number(cash).toLocaleString()} that's a temporary dip of $${dollar}.`;
  if (ddPct < 15)  return `${ddPct.toFixed(1)}% — modest. You'd have seen your $${Number(cash).toLocaleString()} drop by $${dollar} at the worst moment.`;
  if (ddPct < 30)  return `${ddPct.toFixed(1)}% — significant. That's a $${dollar} paper loss at the worst point. Psychologically hard to hold through.`;
  return `${ddPct.toFixed(1)}% — severe. At worst your $${Number(cash).toLocaleString()} dropped $${dollar}. Most traders would have panic-sold.`;
}

function alphaNote(alpha: number | undefined) {
  if (alpha === undefined) return null;
  if (alpha > 5)   return `The strategy beat buy-and-hold by +${alpha.toFixed(1)}% — a meaningful edge.`;
  if (alpha > 0)   return `Slightly ahead of buy-and-hold by +${alpha.toFixed(1)}% — genuine but narrow edge.`;
  if (alpha > -5)  return `Slightly behind buy-and-hold by ${alpha.toFixed(1)}% — transaction costs are eating the edge.`;
  return `Lagged buy-and-hold by ${alpha.toFixed(1)}% — the strategy added friction without adding return.`;
}

function winRateNote(wr: number, avgWin: number, avgLoss: number) {
  const rr = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const msg = rr >= 1.5
    ? `Win rate ${wr}% with ${rr.toFixed(1)}× reward-to-risk — wins are larger than losses. Good edge.`
    : rr >= 1.0
    ? `Win rate ${wr}% with ${rr.toFixed(1)}× reward-to-risk — wins and losses roughly balanced.`
    : `Win rate ${wr}% but reward-to-risk is only ${rr.toFixed(1)}× — losses outsize wins. Needs improvement.`;
  return msg;
}

function BacktestVerdict({ result, cash }: { result: BacktestResult; cash: number }) {
  const sl  = sharpeLabel(result.sharpe);
  const dd  = ddNote(result.max_drawdown, cash);
  const al  = alphaNote(result.alpha);
  const wr  = winRateNote(result.win_rate, result.avg_win, result.avg_loss);

  const verdictColor =
    sl.tier === "Exceptional" || sl.tier === "Excellent" ? "var(--green)" :
    sl.tier === "Good"        ? "var(--blue)"   :
    sl.tier === "Marginal"    ? "var(--yellow)"  : "var(--red)";

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header" style={{ background: "var(--bg-raised)" }}>
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
          <span>Results Interpretation</span>
        </div>
        <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: verdictColor, fontWeight: 600 }}>
          {sl.tier}
        </span>
      </div>
      <div className="p-3 space-y-3">

        {/* Verdict headline */}
        <p style={{ fontFamily: FONT_BODY, fontSize: "13px", lineHeight: 1.75, color: "var(--text-primary)" }}>
          A Sharpe ratio of{" "}
          <span style={{ fontFamily: "'SF Mono', monospace", fontWeight: 700, color: verdictColor }}>
            {result.sharpe.toFixed(2)}
          </span>{" "}
          is <span style={{ fontWeight: 600 }}>{sl.tier.toLowerCase()}</span> — {sl.note}.
          {" "}SPY historically runs 0.5–0.8. Most retail strategies fail to exceed 0.8 over multi-year periods.
        </p>

        {/* Detail bullets */}
        <div className="space-y-2">
          {[
            { label: "Drawdown", text: `Your max drawdown was ${dd}` },
            al ? { label: "Alpha", text: al } : null,
            { label: "Win quality", text: wr },
          ].filter(Boolean).map(row => (
            <div key={(row as { label: string }).label} className="flex gap-2 items-start">
              <span style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
                textTransform: "uppercase", color: "var(--text-muted)", flexShrink: 0, paddingTop: "3px", minWidth: "72px" }}>
                {(row as { label: string }).label}
              </span>
              <span style={{ fontFamily: FONT_BODY, fontSize: "12px", lineHeight: 1.65, color: "var(--text-secondary)" }}>
                {(row as { text: string }).text}
              </span>
            </div>
          ))}
        </div>

        {/* Recommendation chip */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: "11px", fontWeight: 600, color: verdictColor }}>
            {sl.tier === "Exceptional" || sl.tier === "Excellent"
              ? "→ Strong candidate for real-money deployment with proper position sizing."
              : sl.tier === "Good"
              ? "→ Solid strategy. Paper trade for another cycle to confirm consistency."
              : sl.tier === "Marginal"
              ? "→ Edge exists but is thin. Consider tighter filters or a longer test window."
              : "→ Do not trade this with real capital yet. Revisit signal logic and costs."}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Regime colour map ───────────────────────────────────────────────────────

function regimeColor(regime: string): string {
  if (regime.includes("Bull") || regime.includes("Recovery")) return "var(--green)";
  if (regime.includes("Crash") || regime.includes("Bear"))    return "var(--red)";
  if (regime.includes("Sideways") || regime.includes("Quiet"))return "var(--blue)";
  return "var(--yellow)";
}

// ── Regime stress test card ─────────────────────────────────────────────────

function RegimeStressCard({ symbol }: { symbol: string }) {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState<StressTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.backtestStress(symbol, "5y", 100_000);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Stress test failed");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  return (
    <div className="panel overflow-hidden">
      {/* Header — toggle open */}
      <button
        onClick={() => { setOpen(o => !o); if (!open && !data && !loading) run(); }}
        className="panel-header w-full text-left"
        style={{ cursor: "pointer", background: "var(--bg-raised)" }}
      >
        <div className="flex items-center gap-1.5">
          <Shield className="h-3 w-3" style={{ color: "var(--blue)" }} />
          <span>Regime Stress Test</span>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: FONT_BODY }}>
              avg Sharpe {data.mean_sharpe >= 0 ? "+" : ""}{data.mean_sharpe.toFixed(2)}
            </span>
          )}
          {open ? <ChevronUp className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
                : <ChevronDown className="h-3 w-3" style={{ color: "var(--text-muted)" }} />}
        </div>
      </button>

      {open && (
        <div className="p-3 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
              <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>
                Running 5-regime stress test (5y data)…
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs p-3"
              style={{ background: "var(--red-dim)", border: "1px solid var(--red)44", color: "var(--red)" }}>
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span style={{ fontFamily: FONT_BODY }}>{error}</span>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Regimes Tested", value: String(data.n_regimes) },
                  { label: "Mean Sharpe",    value: `${data.mean_sharpe >= 0 ? "+" : ""}${data.mean_sharpe.toFixed(2)}`,
                    color: data.mean_sharpe >= 0.5 ? "var(--green)" : data.mean_sharpe >= 0 ? "var(--yellow)" : "var(--red)" },
                  { label: "Worst DD",       value: `${data.worst_dd.toFixed(1)}%`,
                    color: data.worst_dd > 30 ? "var(--red)" : data.worst_dd > 15 ? "var(--yellow)" : "var(--green)" },
                  { label: "Best Regime",    value: data.best_regime, color: "var(--green)" },
                ].map(s => (
                  <div key={s.label} className="panel p-2 text-center">
                    <div style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.1em",
                      color: "var(--text-muted)", marginBottom: "4px" }}>{s.label}</div>
                    <div style={{ fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "12px",
                      fontWeight: 800, color: s.color ?? "var(--text-primary)" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Per-regime rows */}
              <div className="panel overflow-hidden">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", paddingLeft: "12px" }}>Regime</th>
                      <th style={{ textAlign: "left" }}>Period</th>
                      <th>Return</th>
                      <th>Alpha</th>
                      <th>Sharpe</th>
                      <th>Max DD</th>
                      <th>Win %</th>
                      <th>Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.regimes.map((r: RegimeResult, i: number) => (
                      <tr key={i}>
                        <td style={{ textAlign: "left", paddingLeft: "12px" }}>
                          <span style={{ fontFamily: FONT_BODY, fontSize: "11px", fontWeight: 600,
                            color: regimeColor(r.regime) }}>{r.regime}</span>
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <span style={{ fontFamily: "'SF Mono',monospace", fontSize: "9px",
                            color: "var(--text-muted)" }}>{r.start} – {r.end}</span>
                        </td>
                        <td><span className="num font-semibold" style={{ fontSize: "11px",
                          color: r.total_return >= 0 ? "var(--green)" : "var(--red)" }}>
                          {r.total_return >= 0 ? "+" : ""}{r.total_return.toFixed(1)}%
                        </span></td>
                        <td><span className="num" style={{ fontSize: "11px",
                          color: r.alpha >= 0 ? "var(--green)" : "var(--red)" }}>
                          {r.alpha >= 0 ? "+" : ""}{r.alpha.toFixed(1)}%
                        </span></td>
                        <td><span className="num" style={{ fontSize: "11px",
                          color: r.sharpe >= 0.5 ? "var(--green)" : r.sharpe >= 0 ? "var(--yellow)" : "var(--red)" }}>
                          {r.sharpe.toFixed(2)}
                        </span></td>
                        <td><span className="num" style={{ fontSize: "11px",
                          color: r.max_drawdown > 25 ? "var(--red)" : "var(--text-secondary)" }}>
                          {r.max_drawdown.toFixed(1)}%
                        </span></td>
                        <td className="num" style={{ fontSize: "11px" }}>{r.win_rate.toFixed(0)}%</td>
                        <td className="num" style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.n_trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Plain-English verdict */}
              <div style={{ padding: "10px 14px", background: "rgba(11,31,58,0.04)",
                border: "1px solid var(--border)", fontFamily: FONT_BODY, fontSize: "12px",
                color: "var(--text-secondary)", lineHeight: 1.7 }}>
                {data.mean_sharpe >= 1.0
                  ? `The strategy is robust across all tested regimes (avg Sharpe ${data.mean_sharpe.toFixed(2)}). It holds up in both trending and volatile markets — a strong signal for real-capital deployment.`
                  : data.mean_sharpe >= 0.3
                  ? `Mixed cross-regime performance (avg Sharpe ${data.mean_sharpe.toFixed(2)}). The strategy works better in some regimes than others. Best in ${data.best_regime} periods; most challenged in ${data.worst_regime} conditions.`
                  : `The strategy struggled across regimes (avg Sharpe ${data.mean_sharpe.toFixed(2)}). The worst regime (${data.worst_regime}) drove ${data.worst_dd.toFixed(1)}% drawdown. Consider raising the minimum confidence threshold before live trading.`}
              </div>

              <button onClick={run}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}>
                <RefreshCw className="h-3 w-3" /> Re-run
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PERIODS = ["3mo", "6mo", "1y", "2y", "5y"];

const TIPS = {
  sharpe:   "Risk-adjusted return. >1 = good, >2 = excellent.",
  maxDD:    "Largest peak-to-trough drop during the period.",
  winRate:  "% of trades that were profitable.",
  sortino:  "Like Sharpe but only penalises downside volatility.",
  slippage: "Difference between expected and actual fill price in basis points.",
};

export function SimulatorPanel({ result, loading, onRun, symbol }: {
  result: BacktestResult | null; loading: boolean; onRun: (cash: number, period: string) => void; symbol: string;
}) {
  const [cash,   setCash]   = useState("100000");
  const [period, setPeriod] = useState("1y");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="panel">
        <div className="panel-header">
          <span>Backtest Settings — {symbol}</span>
          <span className="badge badge-yellow">Paper Money</span>
        </div>
        <div className="flex flex-wrap gap-3 items-end p-3">
          <div>
            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Starting Cash</div>
            <div className="flex items-center" style={{ background: "var(--bg-raised)", border: "1px solid var(--border-strong)", borderRadius: 2 }}>
              <span className="px-2 text-xs" style={{ color: "var(--text-muted)" }}>$</span>
              <input type="number" value={cash} onChange={e => setCash(e.target.value)} min="1000" max="10000000"
                className="bg-transparent outline-none text-xs num w-28 py-1.5 pr-2"
                style={{ color: "var(--text-primary)" }} />
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Period</div>
            <div className="flex gap-0 overflow-hidden" style={{ border: "1px solid var(--border)", borderRadius: 2 }}>
              {PERIODS.map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className="px-2.5 py-1.5 text-xs transition-colors"
                  style={{
                    background: period === p ? "var(--blue-dim)" : "transparent",
                    color: period === p ? "var(--blue)" : "var(--text-muted)",
                    borderRight: "1px solid var(--border)",
                  }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => onRun(Number(cash), period)} disabled={loading || Number(cash) < 1000}
            className="et-btn et-btn-primary flex items-center gap-1.5 disabled:opacity-50">
            {loading ? <><Timer className="h-3 w-3 animate-pulse" />Running… {elapsed}s</>
                     : <><FlaskConical className="h-3 w-3" />Run Backtest</>}
          </button>
        </div>
        {loading && (
          <div className="px-3 pb-3 space-y-1.5">
            <div className="h-1 w-full overflow-hidden" style={{ background: "var(--bg-active)" }}>
              <div className="h-full transition-all duration-1000" style={{ width: `${Math.min(95, (elapsed / 60) * 100)}%`, background: "var(--blue)" }} />
            </div>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {elapsed < 10 ? "Fetching historical data…" : elapsed < 25 ? "Training ML model…" : elapsed < 45 ? "Running walk-forward simulation…" : "Computing metrics…"}
            </p>
          </div>
        )}
      </div>

      {result && !loading && (
        <>
          {/* Headline */}
          <div className="panel p-3" style={{ borderColor: result.total_return >= 0 ? "var(--green)" : "var(--red)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Strategy Return — {period}</div>
                <div className="text-3xl font-black num mt-0.5" style={{ color: result.total_return >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtPct(result.total_return)}
                </div>
                <div className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>
                  {fmtMoney(result.initial_cash)} → {fmtMoney(result.final_value)} · {result.n_trades} trades
                </div>
              </div>
            </div>
            {result.bnh_return !== undefined && (
              <div className="grid grid-cols-3 gap-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                {[
                  { label: "Buy & Hold", value: fmtPct(result.bnh_return), color: "var(--blue)" },
                  { label: "Alpha",      value: result.alpha !== undefined ? fmtPct(result.alpha) : "—", color: (result.alpha ?? 0) >= 0 ? "var(--green)" : "var(--red)" },
                  { label: "Win Rate",   value: `${result.win_rate}%`, color: result.win_rate > 50 ? "var(--green)" : "var(--text-secondary)" },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{s.label}</div>
                    <div className="text-sm font-bold num" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Sharpe",     value: fmt(result.sharpe),     good: result.sharpe > 1,      tip: TIPS.sharpe },
              { label: "Sortino",    value: fmt(result.sortino),    good: result.sortino > 1.5,   tip: TIPS.sortino },
              { label: "Max DD",     value: fmtPct(-result.max_drawdown), bad: true,              tip: TIPS.maxDD },
              { label: "Win Rate",   value: `${result.win_rate}%`,  good: result.win_rate > 50,   tip: TIPS.winRate },
              { label: "Avg Win",    value: fmtMoney(result.avg_win),   good: result.avg_win > 0 },
              { label: "Avg Loss",   value: fmtMoney(result.avg_loss),  bad: true },
              { label: "Slippage",   value: `${result.avg_slippage_bps} bps`, tip: TIPS.slippage },
              { label: "Trades",     value: String(result.n_trades) },
            ].map(s => (
              <div key={s.label} className="panel p-2 flex flex-col gap-0.5">
                <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  {s.label} {s.tip && <InfoTooltip content={s.tip} />}
                </div>
                <div className="text-base font-bold num" style={{ color: s.bad ? "var(--red)" : s.good ? "var(--green)" : "var(--text-primary)" }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Plain-English interpretation */}
          <BacktestVerdict result={result} cash={Number(cash)} />

          {/* Regime stress test — collapsible; runs lazily on expand */}
          <RegimeStressCard symbol={symbol} />

          {/* Equity curve */}
          <Card>
            <CardHeader>
              <CardTitle>Equity Curve vs Buy &amp; Hold</CardTitle>
              <span className="num font-bold text-sm" style={{ color: result.total_return >= 0 ? "var(--green)" : "var(--red)" }}>
                {fmtPct(result.total_return)}
              </span>
            </CardHeader>
            <EquityChart snapshots={result.snapshots} initialCash={result.initial_cash} />
          </Card>

          {result.max_drawdown > 15 && (
            <div className="flex items-start gap-2 p-3 text-xs"
              style={{ background: "var(--yellow-dim)", border: "1px solid var(--yellow)44", borderRadius: 2, color: "var(--yellow)" }}>
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {result.max_drawdown.toFixed(1)}% max drawdown (${(result.initial_cash * result.max_drawdown / 100).toFixed(0)} paper loss at worst point). Consider carefully before using real capital.
              </span>
            </div>
          )}

          {/* Trade log */}
          {result.fills.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <span>Trade Log</span>
                <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{result.fills.length} fills · last 20</span>
              </div>
              <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                <table className="t-table">
                  <thead><tr><th>Date</th><th>Side</th><th>Qty</th><th>Price</th><th>Value</th><th>Slip (bps)</th></tr></thead>
                  <tbody>
                    {result.fills.slice(-20).reverse().map((f, i) => (
                      <tr key={i}>
                        <td style={{ textAlign: "left", paddingLeft: "12px", color: "var(--text-muted)" }}>{f.ts.slice(0, 10)}</td>
                        <td><span className="font-semibold" style={{ color: f.side === "buy" ? "var(--green)" : "var(--red)" }}>{f.side.toUpperCase()}</span></td>
                        <td className="num">{f.qty}</td>
                        <td className="num">${fmt(f.price)}</td>
                        <td className="num" style={{ color: "var(--text-secondary)" }}>{fmtMoney(f.nv)}</td>
                        <td className="num" style={{ color: "var(--text-muted)" }}>{fmt(f.slip, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
