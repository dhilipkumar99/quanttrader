"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";
import type { MonteCarlo } from "@/types/quant";

interface Props {
  mc: MonteCarlo;
}

export function MonteCarloChart({ mc }: Props) {
  const data = [
    { label: "P5",  value: mc.p5  - 1, fill: "#f43f5e" },
    { label: "P50", value: mc.p50 - 1, fill: "#6366f1" },
    { label: "P95", value: mc.p95 - 1, fill: "#10b981" },
  ];

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
            formatter={(v: unknown) => [`${(Number(v) * 100).toFixed(2)}%`, "Portfolio Δ"]}
          />
          {data.map((d, i) => (
            <Bar key={i} dataKey="value" fill={d.fill} radius={[4, 4, 0, 0]}>
              <Cell fill={d.fill} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="VaR (5%)"    value={`${mc.var_5pct}%`}  bad />
        <Stat label="CVaR (5%)"   value={`${mc.cvar_5pct}%`} bad />
        <Stat label="Median DD"   value={`${mc.median_dd}%`} bad />
        <Stat label="P(Positive)" value={`${mc.prob_positive}%`} />
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-zinc-800/40 rounded-lg p-2">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wide">{label}</div>
      <div className={bad ? "text-rose-400 font-semibold" : "text-emerald-400 font-semibold"}>
        {value}
      </div>
    </div>
  );
}
