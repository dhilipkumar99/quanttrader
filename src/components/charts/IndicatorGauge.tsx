"use client";

import { InfoTooltip } from "@/components/ui/Tooltip";

interface GaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  invertColor?: boolean;
  tooltip?: string;
}

export function IndicatorGauge({ label, value, min, max, unit = "", invertColor = false, tooltip }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const mid = (max + min) / 2;
  const isHigh = value > mid;
  let color = "#6366f1";
  if (!invertColor) {
    color = isHigh ? "#10b981" : "#f43f5e";
  } else {
    color = isHigh ? "#f43f5e" : "#10b981";
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-0.5">
          {label}
          {tooltip && <InfoTooltip content={tooltip} />}
        </span>
        <span className="text-xs font-semibold" style={{ color }}>
          {value.toFixed(2)}{unit}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
