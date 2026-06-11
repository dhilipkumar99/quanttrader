import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SignalDirection } from "@/types/quant";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function signalLabel(s: SignalDirection): string {
  return s === 1 ? "LONG" : s === -1 ? "SHORT" : "FLAT";
}

export function signalColor(s: SignalDirection): string {
  return s === 1
    ? "text-emerald-400"
    : s === -1
    ? "text-rose-400"
    : "text-zinc-400";
}

export function signalBg(s: SignalDirection): string {
  return s === 1
    ? "bg-emerald-500/15 border-emerald-500/30"
    : s === -1
    ? "bg-rose-500/15 border-rose-500/30"
    : "bg-zinc-700/30 border-zinc-600/30";
}

export function regimeColor(r: string): string {
  const map: Record<string, string> = {
    trending_up:    "text-emerald-400",
    trending_down:  "text-rose-400",
    mean_reverting: "text-amber-400",
    volatile:       "text-orange-400",
    quiet:          "text-zinc-400",
  };
  return map[r] ?? "text-zinc-400";
}

export function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function fmtPct(n: number, dp = 2): string {
  return `${n >= 0 ? "+" : ""}${fmt(n, dp)}%`;
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
