"use client";

import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import type { BacktestSnapshot } from "@/types/quant";
import { fmtPct } from "@/lib/utils";

interface Props {
  snapshots: BacktestSnapshot[];
  initialCash: number;
}

export function EquityChart({ snapshots }: Props) {
  const data = snapshots.map((s) => ({
    t:      s.t.slice(0, 10),
    strat:  s.pnl_pct,
    bnh:    s.bnh_pct ?? 0,
  }));

  const lastStrat = data[data.length - 1]?.strat ?? 0;
  const stratColor = lastStrat >= 0 ? "#10b981" : "#f43f5e";

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="stratGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={stratColor} stopOpacity={0.20} />
            <stop offset="95%" stopColor={stratColor} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
          width={50}
        />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
          formatter={(v: unknown, name: unknown) => {
            const label = name === "strat" ? "Strategy" : "Buy & Hold";
            return [fmtPct(Number(v)), label];
          }}
        />
        <Legend
          formatter={(val) => val === "strat" ? "Strategy" : "Buy & Hold"}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />

        {/* Buy-and-hold baseline */}
        <Line
          type="monotone"
          dataKey="bnh"
          stroke="#6366f1"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          opacity={0.6}
        />

        {/* Strategy */}
        <Area
          type="monotone"
          dataKey="strat"
          stroke={stratColor}
          strokeWidth={2}
          fill="url(#stratGrad)"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
