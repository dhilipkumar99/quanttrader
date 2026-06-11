"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types/quant";

interface Props {
  data: AnalysisResult;
}

export function SignalExplainer({ data }: Props) {
  const [open, setOpen] = useState(false);
  const sig = data.composite_signal;

  const headline =
    sig === 1
      ? `The AI thinks ${data.symbol} is a buying opportunity right now.`
      : sig === -1
      ? `The AI sees warning signs for ${data.symbol} and suggests caution.`
      : `The AI doesn't see a clear direction for ${data.symbol} yet.`;

  const detail =
    sig === 1
      ? `Multiple signals — price momentum, trend analysis, and our machine learning model — are all pointing in the same direction: up. The stock is showing strength relative to its recent history.`
      : sig === -1
      ? `The analysis detected signs of weakness: the price trend is declining, momentum has reversed, and the ML model agrees. This doesn't mean the stock will definitely fall — but risk is elevated.`
      : `The market for ${data.symbol} is mixed right now. Some signals say buy, others say wait. When the AI isn't confident, the safest move is usually to do nothing until the picture clarifies.`;

  const actionLabel =
    sig === 1
      ? `What should I do?`
      : sig === -1
      ? `What should I do?`
      : `What should I do?`;

  const action =
    sig === 1
      ? `If you already own ${data.symbol}, you might consider adding to your position. If not, this could be an entry point — but always invest only what you can afford to lose, and consider using the Simulator to test the strategy first.`
      : sig === -1
      ? `If you own ${data.symbol}, this might be a signal to consider reducing your position or setting a tighter stop-loss. If you don't own it, this is not a good time to buy.`
      : `Hold your current position and wait for a clearer signal. Use this time to run a backtest in the Simulator tab to understand how this strategy has performed historically.`;

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-500/5 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-indigo-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-indigo-300">What does this mean for me?</span>
          <span className="hidden sm:inline text-xs text-indigo-400/60 font-normal">— Plain English explanation</span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-indigo-400" />
          : <ChevronDown className="h-4 w-4 text-indigo-400" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-indigo-500/20 pt-3">
          <p className="text-sm font-semibold text-zinc-100">{headline}</p>
          <p className="text-sm text-zinc-400 leading-relaxed">{detail}</p>

          <div className="bg-zinc-900/60 rounded-lg p-3 border border-zinc-700/30">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">{actionLabel}</div>
            <p className="text-sm text-zinc-300 leading-relaxed">{action}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="bg-zinc-900/40 rounded-lg p-2.5 border border-zinc-800/60">
              <div className="text-zinc-500 mb-1">Suggested Position Size</div>
              <div className="text-zinc-200 font-semibold">
                {data.position_size_pct > 0
                  ? `~${data.position_size_pct}% of your portfolio`
                  : "No position recommended"}
              </div>
              <div className="text-zinc-600 text-[10px] mt-0.5">Calculated by Kelly Criterion</div>
            </div>
            <div className="bg-zinc-900/40 rounded-lg p-2.5 border border-zinc-800/60">
              <div className="text-zinc-500 mb-1">Probability of Profit (21 days)</div>
              <div className={cn(
                "font-semibold",
                data.monte_carlo.prob_positive > 60 ? "text-emerald-400" : data.monte_carlo.prob_positive > 45 ? "text-amber-400" : "text-rose-400"
              )}>
                {data.monte_carlo.prob_positive}%
              </div>
              <div className="text-zinc-600 text-[10px] mt-0.5">Based on 500 simulations</div>
            </div>
            <div className="bg-zinc-900/40 rounded-lg p-2.5 border border-zinc-800/60">
              <div className="text-zinc-500 mb-1">Worst-Case Drawdown</div>
              <div className="text-rose-400 font-semibold">-{data.monte_carlo.worst_dd}%</div>
              <div className="text-zinc-600 text-[10px] mt-0.5">95th percentile scenario</div>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-zinc-600 border-t border-zinc-800/60 pt-3">
            <BookOpen className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong className="text-zinc-500">Disclaimer:</strong> This is not financial advice. Always do your own research and consult a financial advisor before investing. Past performance does not guarantee future results.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
