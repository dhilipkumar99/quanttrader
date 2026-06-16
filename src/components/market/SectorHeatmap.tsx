"use client";
import { useEffect, useState } from "react";
import { marketApi } from "@/lib/marketApi";
import type { SectorData } from "@/types/quant";

function tileStyle(pct: number): React.CSSProperties {
  const intensity = Math.min(Math.abs(pct) / 3, 1);
  const alpha = intensity * 0.75 + 0.08;
  if (pct > 0.2)  return { background: `rgba(0,212,170,${alpha})`,   border: `1px solid rgba(0,212,170,${alpha + 0.1})`,  color: "#fff" };
  if (pct < -0.2) return { background: `rgba(255,71,87,${alpha})`,    border: `1px solid rgba(255,71,87,${alpha + 0.1})`,   color: "#fff" };
  return { background: "var(--bg-raised)", border: "1px solid var(--border)", color: "var(--text-secondary)" };
}

export function SectorHeatmap() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try { const d = await marketApi.sectors(); setSectors(d.sectors); }
      catch { /* silent */ } finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <div className="panel-header">Sector Performance (SPDR ETFs)</div>
      {loading ? (
        <div className="grid grid-cols-4 gap-1.5 p-3">
          {[...Array(11)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse" style={{ background: "var(--bg-raised)", borderRadius: 2 }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-3">
          {sectors.map((s) => (
            <div key={s.etf} className="p-2 text-center cursor-default transition-transform hover:scale-105"
              style={{ ...tileStyle(s.change_pct), borderRadius: 2 }}>
              <div className="text-[9px] font-medium leading-tight opacity-80">{s.name}</div>
              <div className="text-sm font-bold num mt-0.5">
                {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
              </div>
              <div className="text-[9px] opacity-50">{s.etf}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
