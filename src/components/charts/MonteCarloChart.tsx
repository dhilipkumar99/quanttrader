"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { MonteCarlo } from "@/types/quant";

interface Props { mc: MonteCarlo; }

export function MonteCarloChart({ mc }: Props) {
  const data = [
    { label: "P5",  value: mc.p5  - 1, color: "var(--red)" },
    { label: "P50", value: mc.p50 - 1, color: "var(--blue)" },
    { label: "P95", value: mc.p95 - 1, color: "var(--green)" },
  ];

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: "var(--bg-active)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
            formatter={(v: unknown) => [`${(Number(v) * 100).toFixed(2)}%`, "Portfolio Δ"]}
          />
          {data.map((d, i) => (
            <Bar key={i} dataKey="value" radius={[2, 2, 0, 0]}>
              <Cell fill={d.color} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <MCstat label="VaR 5%"      value={`${mc.var_5pct}%`}       bad />
        <MCstat label="CVaR 5%"     value={`${mc.cvar_5pct}%`}      bad />
        <MCstat label="Median DD"   value={`${mc.median_dd}%`}      bad />
        <MCstat label="P(Positive)" value={`${mc.prob_positive}%`}  />
      </div>
    </div>
  );
}

function MCstat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="px-2 py-1.5" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2 }}>
      <div className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-xs font-semibold num" style={{ color: bad ? "var(--red)" : "var(--green)" }}>{value}</div>
    </div>
  );
}
