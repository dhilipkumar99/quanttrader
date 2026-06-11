"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EquityChart } from "@/components/charts/EquityChart";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { fmt, fmtPct, fmtMoney, cn } from "@/lib/utils";
import type { BacktestResult } from "@/types/quant";
import { FlaskConical, TrendingUp, AlertTriangle, Timer } from "lucide-react";

interface Props {
  result: BacktestResult | null;
  loading: boolean;
  onRun: (cash: number, period: string) => void;
  symbol: string;
}

const PERIODS = ["3mo", "6mo", "1y", "2y", "5y"];

const TOOLTIPS = {
  sharpe: "Risk-adjusted return. Above 1.0 is good, above 2.0 is excellent. Compares your return to a risk-free asset.",
  maxDD: "The biggest peak-to-trough drop during the period. Lower is better.",
  winRate: "What percentage of individual trades were profitable.",
  sortino: "Like Sharpe, but only penalizes downside volatility — a more lenient measure.",
  slippage: "The difference between the expected price and the actual fill price, in basis points (1 bps = 0.01%). Lower is better.",
};

export function SimulatorPanel({ result, loading, onRun, symbol }: Props) {
  const [cash, setCash]     = useState("100000");
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

  const bnh = result
    ? ((result.final_value / result.initial_cash - 1) * 100 - result.total_return)
    : null; // approximate buy-and-hold excess

  return (
    <div className="space-y-4">
      {/* ── Hero intro for new users ── */}
      {!result && !loading && (
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex-shrink-0">
              <FlaskConical className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100 mb-1">Paper Trading Simulator</h2>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Test the AI strategy with <strong className="text-zinc-200">virtual money</strong> before risking a single real dollar.
                Choose how much fake cash to start with, select a time window, and see exactly how the strategy would have performed on historical data.
              </p>
              <div className="flex flex-wrap gap-3 mt-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><span className="text-emerald-400">✓</span> No real money at risk</span>
                <span className="flex items-center gap-1"><span className="text-emerald-400">✓</span> Real historical prices</span>
                <span className="flex items-center gap-1"><span className="text-emerald-400">✓</span> Realistic slippage & commissions</span>
                <span className="flex items-center gap-1"><span className="text-emerald-400">✓</span> Compare vs. buy-and-hold</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Controls ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Backtest Settings</CardTitle>
            <Badge variant="warning">Paper Money</Badge>
          </div>
        </CardHeader>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">Symbol</label>
            <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-200 font-semibold min-w-[80px]">
              {symbol}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cash-input" className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">
              Starting Cash
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
              <input
                id="cash-input"
                type="number"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                min="1000"
                max="10000000"
                className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg pl-7 pr-3 py-2 text-sm text-zinc-200 w-40 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                aria-label="Starting cash amount"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">Backtest Period</label>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  aria-pressed={period === p}
                  className={cn(
                    "px-2.5 py-2 rounded-lg text-xs font-medium transition-all border",
                    period === p
                      ? "bg-indigo-500/30 text-indigo-300 border-indigo-500/40"
                      : "bg-zinc-800/40 text-zinc-500 border-zinc-700/30 hover:text-zinc-300 hover:border-zinc-600/40"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onRun(Number(cash), period)}
            disabled={loading || Number(cash) < 1000}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
            aria-label="Run backtest"
          >
            {loading ? (
              <>
                <Timer className="h-4 w-4 animate-pulse" />
                Running… {elapsed}s
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" />
                Run Backtest
              </>
            )}
          </button>
        </div>

        {/* Progress bar during loading */}
        {loading && (
          <div className="mt-4 space-y-2">
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(95, (elapsed / 60) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">
              {elapsed < 10 ? "Fetching historical data…"
                : elapsed < 25 ? "Training ML model on historical data…"
                : elapsed < 45 ? "Running walk-forward simulation…"
                : "Almost done — computing final metrics…"}
            </p>
          </div>
        )}
      </Card>

      {/* ── Results ── */}
      {result && !loading && (
        <>
          {/* Headline stat */}
          <div className={cn(
            "rounded-xl border p-4",
            result.total_return >= 0
              ? "bg-emerald-500/5 border-emerald-500/20"
              : "bg-rose-500/5 border-rose-500/20"
          )}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-zinc-400 mb-0.5">Strategy Return over {period}</div>
                <div className={cn("text-3xl font-black", result.total_return >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {fmtPct(result.total_return)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {fmtMoney(result.initial_cash)} → {fmtMoney(result.final_value)} · {result.n_trades} trades
                </div>
              </div>
              <TrendingUp className={cn("h-10 w-10", result.total_return >= 0 ? "text-emerald-500/30" : "text-rose-500/30")} />
            </div>
            {/* Buy-and-hold comparison */}
            {result.bnh_return !== undefined && (
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-800/60">
                <div className="text-center">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Buy & Hold</div>
                  <div className={cn("text-sm font-bold", result.bnh_return >= 0 ? "text-indigo-400" : "text-rose-400")}>
                    {fmtPct(result.bnh_return)}
                  </div>
                </div>
                <div className="text-center border-x border-zinc-800/60">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Alpha</div>
                  <div className={cn("text-sm font-bold", (result.alpha ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {result.alpha !== undefined ? fmtPct(result.alpha) : "—"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Win Rate</div>
                  <div className={cn("text-sm font-bold", result.win_rate > 50 ? "text-emerald-400" : "text-zinc-400")}>
                    {result.win_rate}%
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Sharpe Ratio" value={fmt(result.sharpe)} good={result.sharpe > 1} tooltip={TOOLTIPS.sharpe} />
            <StatCard label="Sortino Ratio" value={fmt(result.sortino)} good={result.sortino > 1.5} tooltip={TOOLTIPS.sortino} />
            <StatCard label="Max Drawdown" value={fmtPct(-result.max_drawdown)} bad tooltip={TOOLTIPS.maxDD} />
            <StatCard label="Win Rate" value={`${result.win_rate}%`} good={result.win_rate > 50} tooltip={TOOLTIPS.winRate} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Avg Win" value={fmtMoney(result.avg_win)} good={result.avg_win > 0} />
            <StatCard label="Avg Loss" value={fmtMoney(result.avg_loss)} bad />
            <StatCard label="Avg Slippage" value={`${result.avg_slippage_bps} bps`} neutral tooltip={TOOLTIPS.slippage} />
            <StatCard label="Total Trades" value={String(result.n_trades)} neutral />
          </div>

          {/* Equity curve */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Portfolio Equity Curve</CardTitle>
                <p className="text-[10px] text-zinc-500 mt-0.5">Cumulative return % vs. time</p>
              </div>
              <span className={cn("text-lg font-bold", result.total_return >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {fmtPct(result.total_return)}
              </span>
            </CardHeader>
            <EquityChart snapshots={result.snapshots} initialCash={result.initial_cash} />
          </Card>

          {/* Risk warning if drawdown is bad */}
          {result.max_drawdown > 15 && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-300/80">
                This strategy experienced a <strong>{result.max_drawdown.toFixed(1)}% drawdown</strong> during this period.
                That means a ${(result.initial_cash * result.max_drawdown / 100).toFixed(0)} paper loss at its worst point.
                Consider this before using real money.
              </p>
            </div>
          )}

          {/* Trade log */}
          {result.fills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Trade Log</CardTitle>
                <span className="text-xs text-zinc-500">
                  {result.fills.length} total fills · showing last 20
                </span>
              </CardHeader>
              <div className="overflow-auto max-h-64 -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      {["Date", "Action", "Shares", "Price", "Value", "Slippage"].map(h => (
                        <th key={h} className={cn("py-2 font-medium", h === "Date" || h === "Action" ? "text-left px-2" : "text-right px-2")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.fills.slice(-20).reverse().map((f, i) => (
                      <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                        <td className="py-1.5 px-2 text-zinc-500">{f.ts.slice(0, 10)}</td>
                        <td className={cn("py-1.5 px-2 font-semibold", f.side === "buy" ? "text-emerald-400" : "text-rose-400")}>
                          {f.side === "buy" ? "BUY ↑" : "SELL ↓"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-zinc-300">{f.qty}</td>
                        <td className="py-1.5 px-2 text-right text-zinc-300">${fmt(f.price)}</td>
                        <td className="py-1.5 px-2 text-right text-zinc-400">{fmtMoney(f.nv)}</td>
                        <td className="py-1.5 px-2 text-right text-zinc-600">{fmt(f.slip, 1)} bps</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, good, bad, neutral, tooltip }: {
  label: string; value: string; good?: boolean; bad?: boolean; neutral?: boolean; tooltip?: string;
}) {
  const color = neutral ? "text-zinc-300" : bad ? "text-rose-400" : good ? "text-emerald-400" : "text-zinc-300";
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</div>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={cn("text-lg font-bold", color)}>{value}</div>
    </Card>
  );
}
