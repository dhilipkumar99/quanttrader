"use client";

import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { useMemo } from "react";

interface PricePoint {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume?: number;
  signal?: 1 | -1 | 0;
}

interface Props {
  data: PricePoint[];
  symbol: string;
}

// Stacked-bar candle encoding (no scale() needed — pure geometry from Recharts):
//
//  Stack: [lowerWick | lowerBody | body | upperBody | upperWick]
//   lowerWick = min(low, open, close) — 0              → transparent spacer
//   wickBottom = low → min(open,close)                 → thin wick colour
//   body       = |open - close|                        → full colour
//   wickTop    = max(open,close) → high                → thin wick colour
//
// Recharts stacks these as contiguous bars — each segment's x/y/width/height
// is pre-computed by Recharts in pixel space and passed to the shape prop.

function buildRows(data: PricePoint[]) {
  return data.map(d => {
    const isGreen = d.price >= d.open;
    const bodyLo  = Math.min(d.open, d.price);
    const bodyHi  = Math.max(d.open, d.price);
    return {
      ...d,
      isGreen,
      // stacked segments (all must be ≥ 0)
      _spacer:     Math.max(0, d.low),
      _wickLow:    Math.max(0, bodyLo - d.low),
      _body:       Math.max(0.01, bodyHi - bodyLo),
      _wickHigh:   Math.max(0, d.high - bodyHi),
    };
  });
}

// ── Custom bar shapes ─────────────────────────────────────────────────────────
// Recharts passes { x, y, width, height } in pixel space to the shape prop.
// 'y' is the top of the bar segment; 'height' is its pixel height.

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  // We attach our own data via a closure in the Cell approach
  isGreen?: boolean;
  isWick?: boolean;
}

function makeBodyShape(rows: ReturnType<typeof buildRows>) {
  return function BodyShape(props: BarShapeProps) {
    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
    if (height <= 0 || width <= 0) return null;
    const row = rows[index];
    if (!row) return null;
    const color = row.isGreen ? "#1A6B4A" : "#C41E3A";
    const bw = Math.max(2, width * 0.65);
    const bx = x + (width - bw) / 2;
    return <rect x={bx} y={y} width={bw} height={Math.max(1, height)} fill={color} opacity={0.92} />;
  };
}

function makeWickShape(rows: ReturnType<typeof buildRows>) {
  return function WickShape(props: BarShapeProps) {
    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
    if (height <= 0 || width <= 0) return null;
    const row = rows[index];
    if (!row) return null;
    const color = row.isGreen ? "#1A6B4A" : "#C41E3A";
    const cx = x + width / 2;
    return <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1} opacity={0.6} />;
  };
}

// Spacer: invisible
function SpacerShape() { return null; }

function formatDateTick(date: string, idx: number, total: number): string {
  const step = Math.max(1, Math.floor(total / 7));
  if (idx % step !== 0) return "";
  const d = new Date(date);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function CandleTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ payload: ReturnType<typeof buildRows>[0] }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const chg = d.open > 0 ? ((d.price - d.open) / d.open * 100) : 0;
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #D0CAC0",
      padding: "8px 12px", fontSize: 11, minWidth: 140,
    }}>
      <div style={{ color: "#9B9B9B", marginBottom: 6, fontSize: 10 }}>{label}</div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {([
            ["Open",  `$${d.open?.toFixed(2)}`],
            ["High",  `$${d.high?.toFixed(2)}`],
            ["Low",   `$${d.low?.toFixed(2)}`],
            ["Close", `$${d.price?.toFixed(2)}`],
          ] as [string, string][]).map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: "#9B9B9B", paddingRight: 12 }}>{k}</td>
              <td style={{ color: "#0B1F3A", fontWeight: 600, fontFamily: "monospace", textAlign: "right" }}>{v}</td>
            </tr>
          ))}
          <tr>
            <td style={{ color: "#9B9B9B" }}>Chg</td>
            <td style={{ color: chg >= 0 ? "#1A6B4A" : "#C41E3A", fontWeight: 700, fontFamily: "monospace", textAlign: "right" }}>
              {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
            </td>
          </tr>
          {d.volume != null && d.volume > 0 && (
            <tr>
              <td style={{ color: "#9B9B9B" }}>Vol</td>
              <td style={{ color: "#6B6B6B", fontFamily: "monospace", textAlign: "right" }}>
                {d.volume >= 1e6 ? `${(d.volume / 1e6).toFixed(1)}M` : `${(d.volume / 1e3).toFixed(0)}K`}
              </td>
            </tr>
          )}
          {d.signal !== 0 && (
            <tr>
              <td style={{ color: "#9B9B9B" }}>Signal</td>
              <td style={{ color: d.signal === 1 ? "#1A6B4A" : "#C41E3A", fontWeight: 700, textAlign: "right" }}>
                {d.signal === 1 ? "▲ BUY" : "▼ SELL"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PriceChart({ data, symbol }: Props) {
  const rows = useMemo(() => buildRows(data), [data]);

  // Memoize shape components — must not be recreated per render or Recharts re-mounts
  const BodyShape  = useMemo(() => makeBodyShape(rows), [rows]);
  const WickShape  = useMemo(() => makeWickShape(rows), [rows]);

  const prices   = data.flatMap(d => [d.high, d.low]).filter(v => v > 0);
  const minPrice = prices.length ? Math.min(...prices) * 0.997 : 0;
  const maxPrice = prices.length ? Math.max(...prices) * 1.003 : 1;
  const maxVol   = Math.max(...data.map(d => d.volume ?? 0), 1);

  const buySignals  = data.filter(d => d.signal === 1);
  const sellSignals = data.filter(d => d.signal === -1);

  return (
    <div>
      {/* ── Candlestick chart ── */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} margin={{ top: 4, right: 4, left: -4, bottom: 0 }} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke="#D0CAC0" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: "#6B6B6B" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v, i) => formatDateTick(v, i, data.length)}
            interval={0}
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fontSize: 10, fill: "#6B6B6B" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`}
            width={52}
          />

          <Tooltip content={<CandleTooltip />} />

          {/*
            Four stacked Bar layers render each candle:
            1. _spacer:    transparent — lifts the stack to the low price
            2. _wickLow:   thin line — low → body bottom
            3. _body:      full-width rect — open to close
            4. _wickHigh:  thin line — body top → high
          */}
          <Bar dataKey="_spacer" stackId="c" shape={<SpacerShape />} isAnimationActive={false} />
          <Bar dataKey="_wickLow" stackId="c" shape={<WickShape />} isAnimationActive={false} maxBarSize={20} />
          <Bar dataKey="_body" stackId="c" shape={<BodyShape />} isAnimationActive={false} maxBarSize={20} />
          <Bar dataKey="_wickHigh" stackId="c" shape={<WickShape />} isAnimationActive={false} maxBarSize={20} />

          {/* Signal reference lines */}
          {buySignals.map((d, i) => (
            <ReferenceLine key={`b${i}`} x={d.date} stroke="#1A6B4A" strokeWidth={1}
              strokeDasharray="2 5" opacity={0.7}
              label={{ value: "▲", position: "insideBottomLeft", fill: "#1A6B4A", fontSize: 9 }}
            />
          ))}
          {sellSignals.map((d, i) => (
            <ReferenceLine key={`s${i}`} x={d.date} stroke="#C41E3A" strokeWidth={1}
              strokeDasharray="2 5" opacity={0.7}
              label={{ value: "▼", position: "insideTopLeft", fill: "#C41E3A", fontSize: 9 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Volume chart ── */}
      {data.some(d => (d.volume ?? 0) > 0) && (
        <ResponsiveContainer width="100%" height={44}>
          <ComposedChart data={rows} margin={{ top: 0, right: 4, left: -4, bottom: 0 }} barCategoryGap="15%">
            <XAxis dataKey="date" hide />
            <YAxis domain={[0, maxVol * 1.2]} hide />
            <Bar dataKey="volume" isAnimationActive={false} maxBarSize={20}>
              {rows.map((r, i) => (
                <Cell key={i} fill={r.isGreen ? "#1A6B4A55" : "#C41E3A55"} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
