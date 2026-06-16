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

export function IndicatorGauge({ label, value: rawValue, min, max, unit = "", invertColor = false, tooltip }: GaugeProps) {
  const value = rawValue ?? 0;
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const mid = (max + min) / 2;
  const isHigh = value > mid;
  const color = (!invertColor ? isHigh : !isHigh) ? "var(--green)" : "var(--red)";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wide flex items-center gap-0.5"
          style={{ color: "var(--text-muted)" }}>
          {label}
          {tooltip && <InfoTooltip content={tooltip} />}
        </span>
        <span className="text-xs font-semibold num" style={{ color }}>
          {value.toFixed(2)}{unit}
        </span>
      </div>
      <div className="h-1 w-full rounded-none" style={{ background: "var(--bg-active)" }}
        role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
