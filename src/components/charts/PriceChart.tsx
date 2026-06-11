"use client";

import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area
} from "recharts";
import { useMemo } from "react";

interface PricePoint {
  date: string;
  price: number;
  volume?: number;
  signal?: 1 | -1 | 0;
}

interface Props {
  data: PricePoint[];
  symbol: string;
}

export function PriceChart({ data, symbol }: Props) {
  const minPrice = useMemo(() => Math.min(...data.map(d => d.price)) * 0.995, [data]);
  const maxPrice = useMemo(() => Math.max(...data.map(d => d.price)) * 1.005, [data]);
  const firstPrice = data[0]?.price ?? 0;
  const lastPrice  = data[data.length - 1]?.price ?? 0;
  const isPositive = lastPrice >= firstPrice;
  const lineColor  = isPositive ? "#10b981" : "#f43f5e";

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={lineColor} stopOpacity={0.2} />
            <stop offset="95%" stopColor={lineColor} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minPrice, maxPrice]}
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v.toFixed(0)}`}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
          formatter={(v: unknown, name) => {
            if (name === "price") return [`$${Number(v).toFixed(2)}`, symbol];
            return [`${v}`, `${name ?? ""}`];
          }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke={lineColor}
          strokeWidth={2}
          fill="url(#priceGrad)"
          dot={false}
          activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
        />
        {/* Buy signal dots */}
        {data.filter(d => d.signal === 1).map((d, i) => (
          <ReferenceLine
            key={`buy-${i}`}
            x={d.date}
            stroke="#10b981"
            strokeDasharray="2 4"
            strokeWidth={1}
            label={{ value: "▲", position: "insideBottom", fill: "#10b981", fontSize: 10 }}
          />
        ))}
        {/* Sell signal dots */}
        {data.filter(d => d.signal === -1).map((d, i) => (
          <ReferenceLine
            key={`sell-${i}`}
            x={d.date}
            stroke="#f43f5e"
            strokeDasharray="2 4"
            strokeWidth={1}
            label={{ value: "▼", position: "insideTop", fill: "#f43f5e", fontSize: 10 }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
