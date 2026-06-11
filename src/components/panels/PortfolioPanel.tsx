"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { signalColor, signalLabel, fmtPct, fmtMoney, cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types/quant";
import { Plus, X, RefreshCw, TrendingUp, BarChart2, AlertTriangle } from "lucide-react";

interface PortfolioPosition {
  symbol: string;
  analysis: AnalysisResult | null;
  loading: boolean;
  capital: number;
}

const KELLY_TIP = "The Half-Kelly Criterion determines how much of each position's allocated capital should actually be deployed, based on the AI's edge estimate.";
const ALLOC_TIP = "Your total portfolio capital split across positions. The allocation percentage is what you are committing to each symbol.";

export function PortfolioPanel() {
  const [totalCapital, setTotalCapital] = useState(100_000);
  const [positions, setPositions]       = useState<PortfolioPosition[]>([]);
  const [newSymbol, setNewSymbol]       = useState("");
  const [adding, setAdding]             = useState(false);

  const addPosition = useCallback(async (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s || positions.some(p => p.symbol === s)) return;

    const newPos: PortfolioPosition = { symbol: s, analysis: null, loading: true, capital: 10_000 };
    setPositions(prev => [...prev, newPos]);
    setAdding(false);
    setNewSymbol("");

    try {
      const data = await api.analyze(s, "1y");
      setPositions(prev =>
        prev.map(p => p.symbol === s ? { ...p, analysis: data, loading: false } : p)
      );
      toast(`Added ${s} to portfolio`, "success");
    } catch {
      setPositions(prev => prev.map(p => p.symbol === s ? { ...p, loading: false } : p));
      toast(`Failed to load ${s}`, "error");
    }
  }, [positions]);

  const removePosition = (sym: string) =>
    setPositions(prev => prev.filter(p => p.symbol !== sym));

  const updateCapital = (sym: string, val: number) =>
    setPositions(prev => prev.map(p => p.symbol === sym ? { ...p, capital: val } : p));

  const refreshAll = async () => {
    const syms = positions.map(p => p.symbol);
    setPositions(prev => prev.map(p => ({ ...p, loading: true })));
    await Promise.all(syms.map(async (s) => {
      try {
        const data = await api.analyze(s, "1y");
        setPositions(prev => prev.map(p => p.symbol === s ? { ...p, analysis: data, loading: false } : p));
      } catch {
        setPositions(prev => prev.map(p => p.symbol === s ? { ...p, loading: false } : p));
      }
    }));
    toast("Portfolio refreshed", "success");
  };

  const totalAllocated  = positions.reduce((s, p) => s + p.capital, 0);
  const overAllocated   = totalAllocated > totalCapital;
  const longCount       = positions.filter(p => p.analysis?.composite_signal === 1).length;
  const shortCount      = positions.filter(p => p.analysis?.composite_signal === -1).length;

  // Aggregate expected return (capital-weighted)
  const weightedExpReturn = positions.length
    ? positions.reduce((sum, p) => {
        if (!p.analysis || p.capital === 0) return sum;
        return sum + (p.analysis.expected_return * (p.capital / (totalAllocated || 1)));
      }, 0)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-violet-500/15 border border-violet-500/20 flex-shrink-0">
            <BarChart2 className="h-6 w-6 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h2 className="text-lg font-bold text-zinc-100">Portfolio Tracker</h2>
              {positions.length > 0 && (
                <>
                  <Badge variant="success">{longCount} LONG</Badge>
                  {shortCount > 0 && <Badge variant="danger">{shortCount} SHORT</Badge>}
                </>
              )}
            </div>
            <p className="text-sm text-zinc-400 max-w-lg">
              Track multiple stocks simultaneously. The AI analyses each position and shows
              Kelly-sized allocation recommendations across your portfolio.
            </p>
          </div>
        </div>

        {/* Portfolio stats bar */}
        {positions.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-zinc-800/60">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                Total Capital
                <InfoTooltip content="Your total portfolio size. Adjust this to see correct Kelly allocations." />
              </div>
              <div className="relative mt-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                <input
                  type="number"
                  value={totalCapital}
                  onChange={e => setTotalCapital(Number(e.target.value))}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg pl-5 pr-2 py-1 text-sm text-zinc-200 w-full focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                />
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                Allocated
                <InfoTooltip content={ALLOC_TIP} />
              </div>
              <div className={cn("text-sm font-bold mt-1", overAllocated ? "text-rose-400" : "text-zinc-200")}>
                {fmtMoney(totalAllocated)} ({((totalAllocated / totalCapital) * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Positions</div>
              <div className="text-sm font-bold text-zinc-200 mt-1">{positions.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Weighted Exp. Return</div>
              <div className={cn("text-sm font-bold mt-1",
                weightedExpReturn == null ? "text-zinc-500" :
                weightedExpReturn > 0 ? "text-emerald-400" : "text-rose-400"
              )}>
                {weightedExpReturn != null ? fmtPct(weightedExpReturn) : "—"}
              </div>
            </div>
          </div>
        )}

        {overAllocated && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
            Total allocated ({fmtMoney(totalAllocated)}) exceeds total capital ({fmtMoney(totalCapital)}).
            Reduce position sizes or increase total capital.
          </div>
        )}
      </div>

      {/* Allocation bar */}
      {positions.length > 0 && totalCapital > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            Capital Allocation
            <InfoTooltip content="Visual breakdown of how your capital is allocated across positions." />
          </div>
          <div className="flex rounded-full overflow-hidden h-3 bg-zinc-800">
            {positions.map((p, i) => {
              const pct = (p.capital / totalCapital) * 100;
              const colors = ["bg-indigo-500","bg-violet-500","bg-emerald-500","bg-amber-500","bg-rose-500","bg-cyan-500","bg-pink-500","bg-orange-500"];
              return (
                <div
                  key={p.symbol}
                  className={cn("h-full transition-all", colors[i % colors.length])}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                  title={`${p.symbol}: ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {positions.map((p, i) => {
              const colors = ["text-indigo-400","text-violet-400","text-emerald-400","text-amber-400","text-rose-400","text-cyan-400","text-pink-400","text-orange-400"];
              return (
                <span key={p.symbol} className={cn("text-[11px] font-medium", colors[i % colors.length])}>
                  ● {p.symbol} {((p.capital / totalCapital) * 100).toFixed(1)}%
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Position list */}
      {positions.length > 0 && (
        <div className="space-y-3">
          {positions.map(pos => (
            <PositionCard
              key={pos.symbol}
              pos={pos}
              totalCapital={totalCapital}
              onRemove={() => removePosition(pos.symbol)}
              onCapitalChange={(v) => updateCapital(pos.symbol, v)}
            />
          ))}
        </div>
      )}

      {/* Add position row */}
      <Card>
        {adding ? (
          <div className="flex gap-2 items-center">
            <input
              autoFocus
              type="text"
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === "Enter") addPosition(newSymbol);
                if (e.key === "Escape") { setAdding(false); setNewSymbol(""); }
              }}
              placeholder="Ticker (e.g. AAPL)"
              className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 uppercase"
              maxLength={6}
            />
            <button
              onClick={() => addPosition(newSymbol)}
              disabled={!newSymbol.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-all"
            >
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setNewSymbol(""); }}
              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm transition-all"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all border border-zinc-700/40"
            >
              <Plus className="h-4 w-4" />
              Add Symbol
            </button>
            {positions.length > 0 && (
              <button
                onClick={refreshAll}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all border border-zinc-700/40"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh All
              </button>
            )}
          </div>
        )}
      </Card>

      {positions.length === 0 && !adding && (
        <div className="text-center py-12 space-y-2">
          <TrendingUp className="h-8 w-8 text-zinc-700 mx-auto" />
          <p className="text-zinc-500 text-sm">No positions yet</p>
          <p className="text-zinc-600 text-xs max-w-xs mx-auto leading-relaxed">
            Click "Add Symbol" to start tracking stocks. The AI will analyse each one
            and show you Kelly-optimised allocation recommendations.
          </p>
        </div>
      )}
    </div>
  );
}

function PositionCard({ pos, totalCapital, onRemove, onCapitalChange }: {
  pos: PortfolioPosition;
  totalCapital: number;
  onRemove: () => void;
  onCapitalChange: (v: number) => void;
}) {
  const a = pos.analysis;
  const pct = totalCapital > 0 ? (pos.capital / totalCapital) * 100 : 0;
  const kellyAlloc = a ? a.position_size_pct : 0;
  const kellyDollar = (pos.capital * kellyAlloc) / 100;

  return (
    <Card className={cn(
      "border",
      a?.composite_signal === 1  ? "border-emerald-500/20" :
      a?.composite_signal === -1 ? "border-rose-500/20"    : "border-zinc-800/60"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-base font-black text-zinc-100">{pos.symbol}</span>
            {pos.loading ? (
              <span className="text-xs text-zinc-500 animate-pulse">Analysing…</span>
            ) : a ? (
              <>
                <span className={cn("text-sm font-bold", signalColor(a.composite_signal))}>
                  {a.composite_signal === 1 ? "▲" : a.composite_signal === -1 ? "▼" : "■"}{" "}
                  {signalLabel(a.composite_signal)}
                </span>
                <span className="text-xs text-zinc-500">{(a.composite_confidence * 100).toFixed(0)}% conf</span>
                <span className="text-xs text-zinc-400">${a.price.toFixed(2)}</span>
                <span className={cn("text-xs", a.change_pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {a.change_pct >= 0 ? "+" : ""}{a.change_pct.toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="text-xs text-rose-400">Load failed</span>
            )}
          </div>

          {/* Capital input */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-zinc-600 uppercase tracking-wide">
                Allocated Capital
              </label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                <input
                  type="number"
                  value={pos.capital}
                  onChange={e => onCapitalChange(Number(e.target.value))}
                  className="bg-zinc-800/40 border border-zinc-700/30 rounded px-2 pl-5 py-1 text-xs text-zinc-200 w-32 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wide">% of Portfolio</span>
              <span className="text-xs text-zinc-300 font-semibold">{pct.toFixed(1)}%</span>
            </div>
            {a && kellyAlloc > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide flex items-center gap-0.5">
                  Kelly Deploy
                  <InfoTooltip content={KELLY_TIP} />
                </span>
                <span className="text-xs font-semibold text-indigo-400">
                  {fmtMoney(kellyDollar)} ({kellyAlloc}%)
                </span>
              </div>
            )}
            {a && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Exp. Return</span>
                <span className={cn("text-xs font-semibold", a.expected_return > 0 ? "text-emerald-400" : "text-rose-400")}>
                  {fmtPct(a.expected_return)}
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all flex-shrink-0"
          aria-label={`Remove ${pos.symbol}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Risk bar */}
      {a && (
        <div className="mt-3 pt-3 border-t border-zinc-800/40 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-zinc-600 mb-0.5">Sharpe</div>
            <div className={cn("font-semibold", a.risk_metrics.sharpe > 1 ? "text-emerald-400" : "text-zinc-400")}>
              {a.risk_metrics.sharpe.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 mb-0.5">MC Profit%</div>
            <div className={cn("font-semibold",
              a.monte_carlo.prob_positive > 60 ? "text-emerald-400" :
              a.monte_carlo.prob_positive > 45 ? "text-amber-400" : "text-rose-400"
            )}>
              {a.monte_carlo.prob_positive}%
            </div>
          </div>
          <div>
            <div className="text-zinc-600 mb-0.5">Regime</div>
            <div className="text-zinc-400 capitalize">{a.regime.replace(/_/g, " ")}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
