"use client";

import { useState, useRef } from "react";
import { Search, X } from "lucide-react";

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
        <div className="flex items-center gap-2 px-3 py-2"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border-strong)", borderRadius: 2 }}>
          <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => e.key === "Enter" && submit(input)}
            placeholder="Symbol (e.g. AAPL)"
            className="bg-transparent outline-none text-sm font-mono uppercase w-32"
            style={{ color: "var(--text-primary)" }}
          />
          {input && (
            <button onClick={() => { setInput(""); ref.current?.focus(); }} style={{ color: "var(--text-muted)" }}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {focused && (
          <div className="absolute top-full mt-1 left-0 z-50 p-2 w-64"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: 2, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            <div className="text-[9px] uppercase tracking-widest px-2 mb-2" style={{ color: "var(--text-muted)" }}>Popular</div>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR.map((s) => (
                <button
                  key={s}
                  onMouseDown={() => submit(s)}
                  className="px-2 py-1 text-xs transition-all font-mono"
                  style={{ background: "var(--bg-raised)", color: "var(--text-muted)", borderRadius: 2, border: "1px solid var(--border)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--blue-dim)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--blue)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-raised)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Period pills */}
      <div className="flex" style={{ border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden" }}>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className="px-2.5 py-1.5 text-xs transition-colors"
            style={{
              background: period === p ? "var(--blue-dim)" : "transparent",
              color: period === p ? "var(--blue)" : "var(--text-muted)",
              borderRight: "1px solid var(--border)",
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
