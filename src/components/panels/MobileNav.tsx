"use client";

import { useState } from "react";
import { Menu, X, BarChart2, FlaskConical, BookOpen, Info, LayoutDashboard, Globe, Zap, Search, GitCompare, Bot } from "lucide-react";
import Link from "next/link";
import type { WatchlistItem } from "@/types/quant";
import { signalColor, signalLabel, fmtPct } from "@/lib/utils";
import { useTrader } from "@/store/trader";
import type { Tab } from "@/app/page";

interface Props {
  watchlist: WatchlistItem[];
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onSelect: (sym: string) => void;
}

export function MobileNav({ watchlist, activeTab, setActiveTab, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const activeSymbol = useTrader(s => s.activeSymbol);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden p-2 transition-colors"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2, color: "var(--text-muted)" }}
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-72 flex flex-col"
            style={{ background: "var(--bg-surface)", borderLeft: "1px solid var(--border)" }}>

            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" style={{ color: "var(--text-muted)" }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-3 pt-3 pb-2">
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>View</div>
              {([
                { id: "analysis"  as Tab, label: "Analysis",       Icon: BarChart2 },
                { id: "compare"   as Tab, label: "Compare",        Icon: GitCompare },
                { id: "scanner"   as Tab, label: "Scanner",        Icon: Search },
                { id: "market"    as Tab, label: "Market Overview", Icon: Globe },
                { id: "trading"   as Tab, label: "Trade",           Icon: Zap },
                { id: "agent"     as Tab, label: "Agent",           Icon: Bot },
                { id: "simulator" as Tab, label: "Backtest",        Icon: FlaskConical },
                { id: "portfolio" as Tab, label: "Portfolio",       Icon: LayoutDashboard },
              ]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm mb-0.5 transition-all text-left"
                  style={{
                    background: activeTab === id ? "var(--blue-dim)" : "transparent",
                    color: activeTab === id ? "var(--blue)" : "var(--text-muted)",
                    borderRadius: 2,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Links */}
            <div className="px-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Learn</div>
              {[
                { href: "/how-it-works", label: "How It Works", icon: BookOpen },
                { href: "/glossary",     label: "Glossary",     icon: BookOpen },
                { href: "/about",        label: "About",        icon: Info },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm transition-all"
                  style={{ color: "var(--text-muted)", borderRadius: 2 }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              ))}
            </div>

            {/* Watchlist */}
            <div className="flex-1 overflow-auto px-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Watchlist</div>
              {watchlist.map(item => (
                <button
                  key={item.symbol}
                  onClick={() => { onSelect(item.symbol); setOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left transition-all mb-0.5"
                  style={{
                    background: activeSymbol === item.symbol ? "var(--bg-active)" : "transparent",
                    borderRadius: 2,
                  }}
                >
                  <div>
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{item.symbol}</span>
                    <span className="ml-2 text-xs font-bold" style={{ color: signalColor(item.signal) }}>
                      {signalLabel(item.signal)}
                    </span>
                  </div>
                  <span className="text-xs num" style={{ color: item.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                    {fmtPct(item.change_pct)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
