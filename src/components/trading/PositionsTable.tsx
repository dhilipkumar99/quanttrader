"use client";
import { useEffect, useState, useCallback } from "react";
import { marketApi } from "@/lib/marketApi";
import type { BrokerPosition } from "@/types/quant";
import { RefreshCw } from "lucide-react";

export function PositionsTable({ onSelectSymbol }: { onSelectSymbol?: (s: string) => void }) {
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    try { const d = await marketApi.positions(); setPositions(d.positions); }
    catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  const totalPL = positions.reduce((s, p) => s + p.unrealized_pl, 0);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <span>Open Positions</span>
          {positions.length > 0 && (
            <span className="num font-bold text-xs" style={{ color: totalPL >= 0 ? "var(--green)" : "var(--red)" }}>
              {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
            </span>
          )}
        </div>
        <button onClick={load} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {loading && positions.length === 0 ? (
        <div className="p-3 space-y-1">{[...Array(3)].map((_, i) => <div key={i} className="h-7 animate-pulse" style={{ background: "var(--bg-raised)" }} />)}</div>
      ) : positions.length === 0 ? (
        <div className="py-8 text-center text-xs" style={{ color: "var(--text-disabled)" }}>No open positions</div>
      ) : (
        <table className="t-table">
          <thead>
            <tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Price</th><th>Value</th><th>Unreal P&L</th><th>%</th></tr>
          </thead>
          <tbody>
            {positions.map(p => {
              const up = p.unrealized_pl >= 0;
              return (
                <tr key={p.symbol} style={{ cursor: onSelectSymbol ? "pointer" : "default" }} onClick={() => onSelectSymbol?.(p.symbol)}>
                  <td style={{ textAlign: "left", paddingLeft: "12px" }}>
                    <span className="font-bold font-mono" style={{ color: "var(--text-primary)" }}>{p.symbol}</span>
                  </td>
                  <td className="num">{p.qty}</td>
                  <td className="num" style={{ color: "var(--text-secondary)" }}>${p.avg_entry_price.toFixed(2)}</td>
                  <td className="num">${p.current_price.toFixed(2)}</td>
                  <td className="num" style={{ color: "var(--text-secondary)" }}>${p.market_value.toFixed(0)}</td>
                  <td className="num font-semibold" style={{ color: up ? "var(--green)" : "var(--red)" }}>
                    {up ? "+" : ""}${p.unrealized_pl.toFixed(2)}
                  </td>
                  <td className="num" style={{ color: up ? "var(--green)" : "var(--red)" }}>
                    {(p.unrealized_plpc * 100).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
