"use client";

import { useState, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const POPULAR = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
                 "JPM", "SPY", "QQQ", "NFLX", "AMD", "UBER", "COIN"];

interface Props {
  value: string;
  onChange: (sym: string) => void;
  period: string;
  onPeriodChange: (p: string) => void;
}

const PERIODS = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];

export function SearchBar({ value, onChange, period, onPeriodChange }: Props) {
  const [input, setInput]     = useState(value);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (clean) {
      setInput(clean);
      onChange(clean);
      setFocused(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Symbol search */}
      <div className="relative">
        <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-indigo-500/40">
          <Search className="h-4 w-4 text-zinc-500 flex-shrink-0" />
          <input
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => e.key === "Enter" && submit(input)}
            placeholder="Symbol (e.g. AAPL)"
            className="bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none w-36"
          />
          {input && (
            <button onClick={() => { setInput(""); ref.current?.focus(); }}>
              <X className="h-3 w-3 text-zinc-600 hover:text-zinc-400" />
            </button>
          )}
        </div>

        {focused && (
          <div className="absolute top-full mt-1 left-0 z-50 bg-zinc-900 border border-zinc-700/60 rounded-xl p-2 shadow-2xl w-64">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide px-2 mb-2">Popular</div>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR.map((s) => (
                <button
                  key={s}
                  onMouseDown={() => submit(s)}
                  className="px-2 py-1 bg-zinc-800 hover:bg-indigo-500/20 hover:text-indigo-300 text-zinc-400 rounded-md text-xs transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Period pills */}
      <div className="flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
              period === p
                ? "bg-indigo-500/25 text-indigo-300 border border-indigo-500/40"
                : "bg-zinc-800/40 text-zinc-500 border border-zinc-700/30 hover:text-zinc-300"
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
