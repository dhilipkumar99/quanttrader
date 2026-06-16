"use client";

import { useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/Badge";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { signalColor, signalLabel, fmtPct, fmtMoney } from "@/lib/utils";
import type { AnalysisResult } from "@/types/quant";
import { useTrader } from "@/store/trader";
import { Plus, X, RefreshCw, TrendingUp, BarChart2, AlertTriangle } from "lucide-react";
import { PortfolioRiskPanel } from "@/components/panels/PortfolioRiskPanel";
import { PortfolioBacktestPanel } from "@/components/panels/PortfolioBacktestPanel";

interface PortfolioPosition {
  symbol: string;
  analysis: AnalysisResult | null;
  loading: boolean;
  capital: number;
}

const KELLY_TIP = "The Half-Kelly Criterion determines how much of each position's allocated capital should actually be deployed, based on the AI's edge estimate.";
const ALLOC_TIP = "Your total portfolio capital split across positions. The allocation percentage is what you are committing to each symbol.";

const PALETTE = [
  "var(--blue)", "var(--green)", "var(--yellow)", "var(--red)",
  "#a78bfa", "#06b6d4", "#f97316", "#ec4899",
];

export function PortfolioPanel() {
  const { portfolioEntries, portfolioCapital, setPortfolioEntries, setPortfolioCapital } = useTrader();

  // Runtime state — analysis results live only in memory (fetched on mount / add)
  const [positions, setPositions] = useState<PortfolioPosition[]>(() =>
    portfolioEntries.map(e => ({ symbol: e.symbol, capital: e.capital, analysis: null, loading: true }))
  );
  const [newSymbol, setNewSymbol] = useState("");
  const [adding, setAdding]       = useState(false);

  // Sync positions → store (only symbol + capital; never analysis — that's transient)
  useEffect(() => {
    setPortfolioEntries(positions.map(p => ({ symbol: p.symbol, capital: p.capital })));
  }, [positions, setPortfolioEntries]);

  // On mount: re-fetch analysis for every persisted symbol
  useEffect(() => {
    portfolioEntries.forEach(({ symbol: s }) => {
      api.analyze(s, "1y")
        .then(data => setPositions(prev => prev.map(p => p.symbol === s ? { ...p, analysis: data, loading: false } : p)))
        .catch(() => setPositions(prev => prev.map(p => p.symbol === s ? { ...p, loading: false } : p)));
    });
  // run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPosition = useCallback(async (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s || positions.some(p => p.symbol === s)) return;

    setPositions(prev => [...prev, { symbol: s, analysis: null, loading: true, capital: 10_000 }]);
    setAdding(false);
    setNewSymbol("");

    try {
      const data = await api.analyze(s, "1y");
      setPositions(prev => prev.map(p => p.symbol === s ? { ...p, analysis: data, loading: false } : p));
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

  const totalCapital    = portfolioCapital;
  const setTotalCapital = setPortfolioCapital;

  const totalAllocated  = positions.reduce((s, p) => s + p.capital, 0);
  const overAllocated   = totalAllocated > totalCapital;
  const longCount       = positions.filter(p => p.analysis?.composite_signal === 1).length;
  const shortCount      = positions.filter(p => p.analysis?.composite_signal === -1).length;

  const weightedExpReturn = positions.length
    ? positions.reduce((sum, p) => {
        if (!p.analysis || p.capital === 0) return sum;
        return sum + (p.analysis.expected_return * (p.capital / (totalAllocated || 1)));
      }, 0)
    : null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="panel p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 flex-shrink-0" style={{ background: "var(--blue-dim)", border: "1px solid var(--blue)44", borderRadius: 2 }}>
            <BarChart2 className="h-5 w-5" style={{ color: "var(--blue)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Portfolio Tracker</h2>
              {positions.length > 0 && (
                <>
                  <Badge variant="success">{longCount} LONG</Badge>
                  {shortCount > 0 && <Badge variant="danger">{shortCount} SHORT</Badge>}
                </>
              )}
            </div>
            <p className="text-xs max-w-lg" style={{ color: "var(--text-secondary)" }}>
              Track multiple stocks simultaneously. The AI analyses each position and shows
              Kelly-sized allocation recommendations across your portfolio.
            </p>
          </div>
        </div>

        {positions.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div>
              <div className="text-[9px] uppercase tracking-wide flex items-center gap-1 mb-1" style={{ color: "var(--text-muted)" }}>
                Total Capital <InfoTooltip content="Your total portfolio size. Adjust this to see correct Kelly allocations." />
              </div>
              <div className="flex items-center" style={{ background: "var(--bg-raised)", border: "1px solid var(--border-strong)", borderRadius: 2 }}>
                <span className="px-1.5 text-xs" style={{ color: "var(--text-muted)" }}>$</span>
                <input
                  type="number"
                  value={totalCapital}
                  onChange={e => setTotalCapital(Number(e.target.value))}
                  className="bg-transparent outline-none text-xs num py-1.5 pr-2 w-full"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide flex items-center gap-1 mb-1" style={{ color: "var(--text-muted)" }}>
                Allocated <InfoTooltip content={ALLOC_TIP} />
              </div>
              <div className="text-sm font-bold num" style={{ color: overAllocated ? "var(--red)" : "var(--text-primary)" }}>
                {fmtMoney(totalAllocated)} ({((totalAllocated / totalCapital) * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Positions</div>
              <div className="text-sm font-bold num" style={{ color: "var(--text-primary)" }}>{positions.length}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Weighted Exp. Return</div>
              <div className="text-sm font-bold num" style={{ color: weightedExpReturn == null ? "var(--text-disabled)" : weightedExpReturn > 0 ? "var(--green)" : "var(--red)" }}>
                {weightedExpReturn != null ? fmtPct(weightedExpReturn) : "—"}
              </div>
            </div>
          </div>
        )}

        {overAllocated && (
          <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--yellow)" }}>
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Total allocated ({fmtMoney(totalAllocated)}) exceeds total capital ({fmtMoney(totalCapital)}). Reduce position sizes or increase total capital.
          </div>
        )}
      </div>

      {/* Allocation bar */}
      {positions.length > 0 && totalCapital > 0 && (
        <div className="panel p-3">
          <div className="text-[9px] font-semibold uppercase tracking-widest mb-2 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            Capital Allocation <InfoTooltip content="Visual breakdown of how your capital is allocated across positions." />
          </div>
          <div className="flex overflow-hidden h-2" style={{ background: "var(--bg-active)", borderRadius: 1 }}>
            {positions.map((p, i) => {
              const pct = (p.capital / totalCapital) * 100;
              return (
                <div
                  key={p.symbol}
                  className="h-full transition-all"
                  style={{ width: `${Math.min(pct, 100)}%`, background: PALETTE[i % PALETTE.length] }}
                  title={`${p.symbol}: ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-1.5">
            {positions.map((p, i) => (
              <span key={p.symbol} className="text-[10px] font-medium num" style={{ color: PALETTE[i % PALETTE.length] }}>
                ● {p.symbol} {((p.capital / totalCapital) * 100).toFixed(1)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Correlation / concentration risk */}
      {positions.length >= 2 && (
        <PortfolioRiskPanel
          symbols={positions.map(p => p.symbol)}
          period="1y"
        />
      )}

      {/* Multi-symbol portfolio backtest */}
      {positions.length >= 2 && (
        <PortfolioBacktestPanel
          symbols={positions.map(p => p.symbol)}
          totalCash={totalCapital}
        />
      )}

      {/* Position list */}
      {positions.length > 0 && (
        <div className="space-y-2">
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
      <div className="panel p-3">
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
              className="et-input flex-1 font-mono uppercase"
              maxLength={6}
            />
            <button onClick={() => addPosition(newSymbol)} disabled={!newSymbol.trim()} className="et-btn et-btn-primary disabled:opacity-50 text-xs">Add</button>
            <button onClick={() => { setAdding(false); setNewSymbol(""); }} className="et-btn et-btn-secondary text-xs">Cancel</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setAdding(true)} className="et-btn et-btn-secondary flex items-center gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add Symbol
            </button>
            {positions.length > 0 && (
              <button onClick={refreshAll} className="et-btn et-btn-secondary flex items-center gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh All
              </button>
            )}
          </div>
        )}
      </div>

      {positions.length === 0 && !adding && (
        <div className="text-center py-12 space-y-2">
          <TrendingUp className="h-8 w-8 mx-auto" style={{ color: "var(--text-disabled)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No positions yet</p>
          <p className="text-xs max-w-xs mx-auto leading-relaxed" style={{ color: "var(--text-disabled)" }}>
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
  const kellyAlloc  = a ? a.position_size_pct : 0;
  const kellyDollar = (pos.capital * kellyAlloc) / 100;

  const borderColor = a?.composite_signal === 1  ? "var(--green)44" :
                      a?.composite_signal === -1 ? "var(--red)44"   : "var(--border)";

  return (
    <div className="panel p-3" style={{ borderColor }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-base font-black" style={{ color: "var(--text-primary)" }}>{pos.symbol}</span>
            {pos.loading ? (
              <span className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>Analysing…</span>
            ) : a ? (
              <>
                <span className="text-sm font-bold" style={{ color: signalColor(a.composite_signal) }}>
                  {a.composite_signal === 1 ? "▲" : a.composite_signal === -1 ? "▼" : "■"}{" "}
                  {signalLabel(a.composite_signal)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{(a.composite_confidence * 100).toFixed(0)}% conf</span>
                <span className="text-xs num" style={{ color: "var(--text-secondary)" }}>${a.price.toFixed(2)}</span>
                <span className="text-xs num" style={{ color: a.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                  {a.change_pct >= 0 ? "+" : ""}{a.change_pct.toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="text-xs" style={{ color: "var(--red)" }}>Load failed</span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Allocated Capital</label>
              <div className="flex items-center" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2 }}>
                <span className="px-1.5 text-xs" style={{ color: "var(--text-muted)" }}>$</span>
                <input
                  type="number"
                  value={pos.capital}
                  onChange={e => onCapitalChange(Number(e.target.value))}
                  className="bg-transparent outline-none text-xs num py-1 pr-2 w-28"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>% of Portfolio</span>
              <span className="text-xs font-semibold num" style={{ color: "var(--text-secondary)" }}>{pct.toFixed(1)}%</span>
            </div>
            {a && kellyAlloc > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide flex items-center gap-0.5" style={{ color: "var(--text-muted)" }}>
                  Kelly Deploy <InfoTooltip content={KELLY_TIP} />
                </span>
                <span className="text-xs font-semibold num" style={{ color: "var(--blue)" }}>
                  {fmtMoney(kellyDollar)} ({kellyAlloc}%)
                </span>
              </div>
            )}
            {a && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Exp. Return</span>
                <span className="text-xs font-semibold num" style={{ color: a.expected_return > 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtPct(a.expected_return)}
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onRemove}
          className="p-1.5 transition-colors flex-shrink-0"
          style={{ color: "var(--text-muted)", borderRadius: 2 }}
          aria-label={`Remove ${pos.symbol}`}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {a && (
        <div className="mt-2 pt-2 grid grid-cols-3 gap-2 text-xs" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <div className="mb-0.5" style={{ color: "var(--text-muted)" }}>Sharpe</div>
            <div className="font-semibold num" style={{ color: (a.risk_metrics?.sharpe ?? 0) > 1 ? "var(--green)" : "var(--text-secondary)" }}>
              {(a.risk_metrics?.sharpe ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="mb-0.5" style={{ color: "var(--text-muted)" }}>MC Profit%</div>
            <div className="font-semibold num" style={{ color: a.monte_carlo.prob_positive > 60 ? "var(--green)" : a.monte_carlo.prob_positive > 45 ? "var(--yellow)" : "var(--red)" }}>
              {a.monte_carlo.prob_positive}%
            </div>
          </div>
          <div>
            <div className="mb-0.5" style={{ color: "var(--text-muted)" }}>Regime</div>
            <div className="capitalize" style={{ color: "var(--text-secondary)" }}>{a.regime.replace(/_/g, " ")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
