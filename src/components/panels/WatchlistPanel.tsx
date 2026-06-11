"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { signalLabel, signalColor, signalBg, fmtPct, fmt, cn } from "@/lib/utils";
import type { WatchlistItem } from "@/types/quant";
import { useTrader } from "@/store/trader";

interface Props {
  items: WatchlistItem[];
  onSelect: (sym: string) => void;
}

export function WatchlistPanel({ items, onSelect }: Props) {
  const activeSymbol = useTrader((s) => s.activeSymbol);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Watchlist</CardTitle>
        <span className="text-[10px] text-zinc-500">↓ by conviction</span>
      </CardHeader>
      <div className="overflow-auto max-h-[500px] space-y-1 pr-1">
        {items.map((item) => (
          <button
            key={item.symbol}
            onClick={() => onSelect(item.symbol)}
            className={cn(
              "w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all",
              "hover:bg-zinc-800/60",
              activeSymbol === item.symbol ? "bg-zinc-800/80 ring-1 ring-indigo-500/40" : "bg-zinc-900/30"
            )}
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-zinc-100">{item.symbol}</span>
                <span className={cn("text-[10px] font-bold", signalColor(item.signal))}>
                  {signalLabel(item.signal)}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500">{item.regime.replace("_", " ")}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs font-semibold text-zinc-200">${fmt(item.price)}</span>
              <span className={cn("text-[10px]", item.change_pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {fmtPct(item.change_pct)}
              </span>
              <span className="text-[10px] text-zinc-500">
                K {item.kelly_pct.toFixed(1)}%
              </span>
            </div>
          </button>
        ))}
        {items.length === 0 && (
          <div className="text-zinc-600 text-sm text-center py-8">Loading watchlist…</div>
        )}
      </div>
    </Card>
  );
}
