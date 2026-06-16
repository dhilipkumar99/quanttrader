"use client";
import { useState, useRef, useEffect } from "react";
import type { Tab } from "@/app/page";
import { Menu, Search } from "lucide-react";
import { AlertBell } from "@/components/ui/AlertBell";

const PERIODS = ["1mo","3mo","6mo","1y","2y","5y"];

interface Props {
  symbol: string;
  onSymbolChange: (s: string) => void;
  period: string;
  onPeriodChange: (p: string) => void;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ symbol, onSymbolChange, period, onPeriodChange, activeTab, onTabChange, sidebarCollapsed, onToggleSidebar }: Props) {
  const [input, setInput] = useState(symbol);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setInput(symbol); }, [symbol]);

  const submit = () => {
    const s = input.trim().toUpperCase();
    if (s && s !== symbol) onSymbolChange(s);
  };

  const TABS: { id: Tab; label: string; key: string }[] = [
    { id: "picks",     label: "Best Picks", key: "K" },
    { id: "analysis",  label: "Analysis",   key: "A" },
    { id: "compare",   label: "Compare",    key: "C" },
    { id: "scanner",   label: "Scanner",    key: "N" },
    { id: "market",    label: "Market",     key: "M" },
    { id: "trading",   label: "Trade",      key: "T" },
    { id: "agent",     label: "Agent",      key: "G" },
    { id: "simulator", label: "Backtest",   key: "S" },
    { id: "portfolio", label: "Portfolio",  key: "P" },
  ];

  return (
    <header
      style={{
        background: "#0B1F3A",
        borderBottom: "2px solid #C41E3A",
        height: "48px",
      }}
      className="flex items-center gap-0 flex-shrink-0 z-40"
    >

      {/* Logo / collapse */}
      <div
        style={{
          width: sidebarCollapsed ? "48px" : "180px",
          borderRight: "1px solid rgba(255,255,255,0.1)",
        }}
        className="h-full flex items-center justify-between px-3 flex-shrink-0 transition-all duration-200"
      >
        {!sidebarCollapsed && (
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, gap: 0 }}>
            <span style={{
              fontFamily: "'Times New Roman', Times, Georgia, serif",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
              letterSpacing: "0.02em",
              lineHeight: 1,
            }}>
              QuantTrader
            </span>
            <span style={{
              fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
              fontSize: "8px",
              fontWeight: 400,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              marginTop: "2px",
              lineHeight: 1,
            }}>
              ML-POWERED
            </span>
          </div>
        )}
        <button
          onClick={onToggleSidebar}
          style={{ color: "rgba(255,255,255,0.55)" }}
          className="hover:text-white transition-colors"
        >
          <Menu className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Symbol search */}
      <div
        className="flex items-center gap-0 px-3"
        style={{ borderRight: "1px solid rgba(255,255,255,0.1)", height: "100%" }}
      >
        <Search className="h-3 w-3 flex-shrink-0 mr-2" style={{ color: "rgba(255,255,255,0.4)" }} />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && submit()}
          onBlur={submit}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 0,
            color: "#FFFFFF",
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: "12px",
            padding: "3px 6px",
            outline: "none",
            width: "80px",
            textTransform: "uppercase",
          }}
          placeholder="SYMBOL"
        />
      </div>

      {/* Period selector */}
      <div className="flex items-center h-full" style={{ borderRight: "1px solid rgba(255,255,255,0.1)" }}>
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className="px-2.5 h-full transition-colors"
            style={{
              fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: period === p ? "#FFFFFF" : "rgba(255,255,255,0.5)",
              background: period === p ? "rgba(196,30,58,0.25)" : "transparent",
              borderBottom: period === p ? "2px solid #C41E3A" : "2px solid transparent",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="flex items-center h-full flex-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="px-4 h-full whitespace-nowrap transition-all flex items-center gap-1.5"
            style={{
              fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: activeTab === tab.id ? "#FFFFFF" : "rgba(255,255,255,0.6)",
              borderBottom: activeTab === tab.id ? "2px solid #C41E3A" : "2px solid transparent",
              background: activeTab === tab.id ? "rgba(196,30,58,0.12)" : "transparent",
            }}
          >
            {tab.label}
            <span
              className="hidden lg:inline"
              style={{
                fontSize: "9px",
                padding: "1px 4px",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.3)",
                fontFamily: "monospace",
              }}
            >
              {tab.key}
            </span>
          </button>
        ))}
      </div>

      {/* Right: alerts bell + LIVE status */}
      <div
        className="flex items-center flex-shrink-0 h-full"
        style={{ borderLeft: "1px solid rgba(255,255,255,0.1)" }}
      >
        <AlertBell />
      </div>
      <div
        className="px-3 flex items-center gap-2 flex-shrink-0"
        style={{ borderLeft: "1px solid rgba(255,255,255,0.1)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full animate-pulse"
          style={{ background: "#1A6B4A" }}
        />
        <span style={{
          fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
          fontSize: "9px",
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
        }}>
          LIVE
        </span>
      </div>
    </header>
  );
}
