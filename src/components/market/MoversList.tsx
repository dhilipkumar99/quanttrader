"use client";
import { useEffect, useState } from "react";
import { marketApi } from "@/lib/marketApi";
import type { MarketMover } from "@/types/quant";
import { RefreshCw } from "lucide-react";

export function MoversList({ onSelectSymbol }: { onSelectSymbol?: (s: string) => void }) {
  const [gainers, setGainers] = useState<MarketMover[]>([]);
  const [losers,  setLosers]  = useState<MarketMover[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<"gainers" | "losers">("gainers");

  useEffect(() => {
    const load = async () => {
      try { const d = await marketApi.movers(10); setGainers(d.gainers ?? []); setLosers(d.losers ?? []); }
      catch { /* silent */ } finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 90_000);
    return () => clearInterval(id);
  }, []);

  const list = tab === "gainers" ? gainers : losers;

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Movers</span>
        <div className="flex gap-0 overflow-hidden" style={{ border: "1px solid var(--border)", borderRadius: 2 }}>
          {(["gainers", "losers"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-2.5 py-0.5 text-[10px] capitalize transition-colors"
              style={{
                background: tab === t ? (t === "gainers" ? "var(--green-dim)" : "var(--red-dim)") : "transparent",
                color: tab === t ? (t === "gainers" ? "var(--green)" : "var(--red)") : "var(--text-muted)",
              }}>
              {t === "gainers" ? "▲" : "▼"} {t}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="p-3 space-y-1.5">
          {[...Array(8)].map((_, i) => <div key={i} className="h-7 animate-pulse" style={{ background: "var(--bg-raised)", borderRadius: 2 }} />)}
        </div>
      ) : (
        <table className="t-table">
          <thead><tr><th>Symbol</th><th>Price</th><th>Change</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.symbol} style={{ cursor: onSelectSymbol ? "pointer" : "default" }} onClick={() => onSelectSymbol?.(m.symbol)}>
                <td style={{ textAlign: "left", paddingLeft: "12px" }}>
                  <span className="font-bold font-mono" style={{ color: "var(--text-primary)" }}>{m.symbol}</span>
                </td>
                <td className="num">${m.price.toFixed(2)}</td>
                <td>
                  <span className="num font-semibold" style={{ color: m.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                    {m.change_pct >= 0 ? "+" : ""}{m.change_pct.toFixed(2)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
