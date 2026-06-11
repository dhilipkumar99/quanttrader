"use client";

import { useState } from "react";
import { Menu, X, BarChart2, FlaskConical, BookOpen, Info, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { WatchlistItem } from "@/types/quant";
import { signalColor, signalLabel, fmtPct } from "@/lib/utils";
import { useTrader } from "@/store/trader";

type Tab = "live" | "simulator" | "portfolio";

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
        className="lg:hidden p-2 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-zinc-200"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-80 bg-zinc-900 border-l border-zinc-800/60 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
              <span className="text-sm font-bold text-zinc-100">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-4 pt-4 pb-2">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">View</div>
              {([
                { id: "live" as Tab,      label: "Live Analysis",   Icon: BarChart2 },
                { id: "simulator" as Tab, label: "Paper Simulator", Icon: FlaskConical },
                { id: "portfolio" as Tab, label: "Portfolio",        Icon: LayoutDashboard },
              ]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-1 transition-all text-left",
                    activeTab === id ? "bg-indigo-600/25 text-indigo-300" : "text-zinc-400 hover:bg-zinc-800/60"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Links */}
            <div className="px-4 py-2 border-t border-zinc-800/60">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Learn</div>
              {[
                { href: "/how-it-works", label: "How It Works", icon: BookOpen },
                { href: "/glossary",     label: "Glossary",     icon: BookOpen },
                { href: "/about",        label: "About",        icon: Info },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-all"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </div>

            {/* Watchlist */}
            <div className="flex-1 overflow-auto px-4 py-2 border-t border-zinc-800/60">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Watchlist</div>
              {watchlist.map(item => (
                <button
                  key={item.symbol}
                  onClick={() => { onSelect(item.symbol); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all mb-0.5",
                    activeSymbol === item.symbol ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                  )}
                >
                  <div>
                    <span className="text-sm font-semibold text-zinc-100">{item.symbol}</span>
                    <span className={cn("ml-2 text-xs font-bold", signalColor(item.signal))}>
                      {signalLabel(item.signal)}
                    </span>
                  </div>
                  <span className={cn("text-xs", item.change_pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
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
