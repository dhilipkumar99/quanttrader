"use client";
import { useEffect, useState } from "react";
import { marketApi } from "@/lib/marketApi";
import type { IndexData } from "@/types/quant";

export function IndicesStrip() {
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try { const d = await marketApi.indices(); setIndices(d.indices); }
      catch { /* silent */ } finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return (
    <div className="flex gap-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-14 w-32 flex-shrink-0 animate-pulse" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2 }} />
      ))}
    </div>
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {indices.map((idx) => {
        const up = idx.change_pct >= 0;
        return (
          <div key={idx.symbol} className="flex-shrink-0 px-3 py-2 min-w-[110px]"
            style={{
              background: up ? "var(--green-dim)" : "var(--red-dim)",
              border: `1px solid ${up ? "var(--green)" : "var(--red)"}33`,
              borderRadius: 2,
            }}>
            <div className="text-[9px] uppercase tracking-wide truncate" style={{ color: "var(--text-muted)" }}>{idx.name}</div>
            <div className="text-sm font-bold num mt-0.5" style={{ color: "var(--text-primary)" }}>
              {idx.price.toLocaleString()}
            </div>
            <div className="text-[10px] font-semibold num" style={{ color: up ? "var(--green)" : "var(--red)" }}>
              {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
