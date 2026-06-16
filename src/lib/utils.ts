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
  return s === 1 ? "var(--green)" : s === -1 ? "var(--red)" : "var(--text-muted)";
}

export function signalBg(s: SignalDirection): string {
  return s === 1 ? "var(--green-dim)" : s === -1 ? "var(--red-dim)" : "var(--bg-active)";
}

export function regimeColor(r: string): string {
  const map: Record<string, string> = {
    trending_up:    "var(--green)",
    trending_down:  "var(--red)",
    mean_reverting: "var(--yellow)",
    volatile:       "var(--yellow)",
    quiet:          "var(--text-muted)",
  };
  return map[r] ?? "var(--text-muted)";
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
