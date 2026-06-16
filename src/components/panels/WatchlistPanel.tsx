"use client";

import { signalLabel, fmtPct, fmt } from "@/lib/utils";
import type { WatchlistItem } from "@/types/quant";
import { useTrader } from "@/store/trader";

export function WatchlistPanel({ items, onSelect }: { items: WatchlistItem[]; onSelect: (s: string) => void }) {
  const activeSymbol = useTrader((s) => s.activeSymbol);

  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      <div className="panel-header">
        <span>Watchlist</span>
        <span style={{ color: "var(--text-disabled)", fontSize: "9px" }}>↓ conviction</span>
      </div>
      <div className="overflow-y-auto flex-1">
        {items.map((item) => {
          const sigColor = item.signal === 1 ? "var(--green)" : item.signal === -1 ? "var(--red)" : "var(--yellow)";
          const active = activeSymbol === item.symbol;
          return (
            <button
              key={item.symbol}
              onClick={() => onSelect(item.symbol)}
              className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors"
              style={{
                background: active ? "var(--bg-active)" : "transparent",
                borderLeft: active ? `2px solid var(--blue)` : "2px solid transparent",
              }}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold font-mono" style={{ color: "var(--text-primary)" }}>{item.symbol}</span>
                  <span className="text-[9px] font-bold" style={{ color: sigColor }}>{signalLabel(item.signal)}</span>
                </div>
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{item.regime.replace("_", " ")}</span>
              </div>
              <div className="text-right">
                <div className="text-xs num font-semibold" style={{ color: "var(--text-primary)" }}>${fmt(item.price)}</div>
                <div className="text-[9px] num" style={{ color: item.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtPct(item.change_pct)}
                </div>
              </div>
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-8 text-xs" style={{ color: "var(--text-disabled)" }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
