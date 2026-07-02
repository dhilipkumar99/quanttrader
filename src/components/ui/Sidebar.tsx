"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import type { Tab } from "@/app/page";
import { useTrader } from "@/store/trader";
import { cn, fmtPct } from "@/lib/utils";
import {
  BarChart2, Globe, Zap, LayoutDashboard,
  Info, BookOpen, Plus, X, GitCompare, Crosshair, Activity,
} from "lucide-react";
import Link from "next/link";

const NAV_ITEMS: { id: Tab; label: string; Icon: React.FC<{ className?: string }>; key: string }[] = [
  { id: "picks",     label: "Top Picks",  Icon: Crosshair,       key: "K" },
  { id: "analysis",  label: "Analysis",   Icon: BarChart2,       key: "A" },
  { id: "intraday",  label: "Live Chart", Icon: Activity,        key: "I" },
  { id: "compare",   label: "Compare",    Icon: GitCompare,      key: "C" },
  { id: "market",    label: "Market",     Icon: Globe,           key: "M" },
  { id: "trading",   label: "Trade",      Icon: Zap,             key: "T" },
  { id: "portfolio", label: "Portfolio",  Icon: LayoutDashboard, key: "P" },
];

interface Props {
  collapsed: boolean;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  onSelectSymbol: (s: string) => void;
}

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

export function Sidebar({ collapsed, activeTab, onTabChange, onSelectSymbol }: Props) {
  const { watchlist, activeSymbol, pinnedSymbols, pinSymbol, unpinSymbol } = useTrader();

  // Index watchlist quotes by symbol for O(1) lookup
  const quoteMap = useMemo(() => {
    const m: Record<string, { price: number; change_pct: number; signal: number }> = {};
    for (const w of watchlist) m[w.symbol] = w;
    return m;
  }, [watchlist]);

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200 h-full"
      style={{
        width: collapsed ? "48px" : "180px",
        background: "#0B1F3A",
        borderRight: "2px solid #C41E3A",
      }}
    >
      {/* Nav items */}
      <nav className="flex flex-col py-1">
        {NAV_ITEMS.map(({ id, label, Icon, key }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              title={collapsed ? `${label} (${key})` : undefined}
              className="flex items-center gap-2.5 px-3 py-2 text-left transition-colors w-full"
              style={{
                fontFamily: FONT_BODY,
                fontSize: "11px",
                fontWeight: active ? 600 : 400,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: active ? "#FFFFFF" : "rgba(255,255,255,0.6)",
                background: active ? "rgba(196,30,58,0.12)" : "transparent",
                borderLeft: active ? "2px solid #C41E3A" : "2px solid transparent",
              }}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
              {!collapsed && (
                <span style={{ marginLeft: "auto", fontSize: "9px", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                  {key}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

      {/* Watchlist — full when expanded */}
      {!collapsed && (
        <WatchlistPanel
          pinnedSymbols={pinnedSymbols}
          quoteMap={quoteMap}
          activeSymbol={activeSymbol}
          onSelectSymbol={onSelectSymbol}
          onPin={pinSymbol}
          onUnpin={unpinSymbol}
        />
      )}

      {/* Collapsed: abbreviated pinned symbols */}
      {collapsed && pinnedSymbols.length > 0 && (
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 py-1">
          {pinnedSymbols.map(sym => {
            const q = quoteMap[sym];
            return (
              <button
                key={sym}
                onClick={() => onSelectSymbol(sym)}
                title={`${sym}${q ? ` ${fmtPct(q.change_pct)}` : ""}`}
                className="w-full flex items-center justify-center py-1.5 transition-colors"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "9px",
                  fontWeight: 700,
                  color: activeSymbol === sym ? "#FFFFFF" : "rgba(255,255,255,0.45)",
                  background: activeSymbol === sym ? "rgba(196,30,58,0.12)" : "transparent",
                }}
              >
                {sym.slice(0, 4)}
              </button>
            );
          })}
        </div>
      )}

      {/* Footer links */}
      {!collapsed && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "4px 0" }}>
          {[
            { href: "/learn",  label: "Trading Guide",  Icon: BookOpen },
            { href: "/about",  label: "About",          Icon: Info },
          ].map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 px-3 py-1.5 transition-colors"
              style={{ fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 400, letterSpacing: "0.06em", color: "rgba(255,255,255,0.4)" }}
            >
              <Icon className="h-3 w-3 flex-shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

// ── WatchlistPanel ─────────────────────────────────────────────────────────────

interface WatchlistPanelProps {
  pinnedSymbols: string[];
  quoteMap: Record<string, { price: number; change_pct: number; signal: number }>;
  activeSymbol: string;
  onSelectSymbol: (s: string) => void;
  onPin: (s: string) => void;
  onUnpin: (s: string) => void;
}

function WatchlistPanel({ pinnedSymbols, quoteMap, activeSymbol, onSelectSymbol, onPin, onUnpin }: WatchlistPanelProps) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header row */}
      <div style={{ padding: "6px 12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C41E3A" }}>
          Watchlist
        </span>
        <button
          onClick={() => setAdding(a => !a)}
          title="Add symbol"
          style={{ color: adding ? "#C41E3A" : "rgba(255,255,255,0.4)", lineHeight: 1, background: "none", border: "none", cursor: "pointer", padding: "2px" }}
        >
          {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>
      </div>

      {/* Search box */}
      {adding && (
        <SymbolSearch
          onAdd={(sym) => { onPin(sym); setAdding(false); onSelectSymbol(sym); }}
          onClose={() => setAdding(false)}
          alreadyPinned={pinnedSymbols}
        />
      )}

      {/* Pinned list */}
      <div className="flex-1 overflow-y-auto">
        {pinnedSymbols.length === 0 && !adding ? (
          <div style={{ padding: "12px", textAlign: "center" }}>
            <p style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
              Add your favourite stocks here for quick access and live price updates.
            </p>
            <button
              onClick={() => setAdding(true)}
              style={{
                marginTop: "8px", fontFamily: FONT_BODY, fontSize: "10px",
                color: "rgba(255,255,255,0.5)", background: "none", border: "none",
                cursor: "pointer", textDecoration: "underline",
              }}
            >
              + Add a stock
            </button>
          </div>
        ) : (
          pinnedSymbols.map(sym => {
            const q = quoteMap[sym];
            const isActive = activeSymbol === sym;
            return (
              <div
                key={sym}
                className="group flex items-center w-full transition-colors"
                style={{
                  background: isActive ? "rgba(196,30,58,0.12)" : "transparent",
                  borderLeft: isActive ? "2px solid #C41E3A" : "2px solid transparent",
                }}
              >
                <button
                  onClick={() => onSelectSymbol(sym)}
                  className="flex-1 flex items-center justify-between px-3 py-1.5 text-left"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600, color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.85)" }}>
                    {sym}
                  </span>
                  {q ? (
                    <span style={{ fontFamily: FONT_MONO, fontSize: "10px", color: q.change_pct >= 0 ? "#1A6B4A" : "#C41E3A", fontWeight: 500 }}>
                      {q.change_pct >= 0 ? "+" : ""}{q.change_pct.toFixed(2)}%
                    </span>
                  ) : (
                    <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "rgba(255,255,255,0.2)" }}>—</span>
                  )}
                </button>
                {/* Remove button — only on hover */}
                <button
                  onClick={() => onUnpin(sym)}
                  title={`Remove ${sym}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity pr-2"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#C41E3A")}
                  onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── SymbolSearch ───────────────────────────────────────────────────────────────
// Loads the full SP500 symbol list once, then filters client-side — zero API calls per keystroke.

interface SymbolSearchProps {
  onAdd: (sym: string) => void;
  onClose: () => void;
  alreadyPinned: string[];
}

function SymbolSearch({ onAdd, onClose, alreadyPinned }: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load full symbol list once — cached in module scope
  useEffect(() => {
    loadSymbols().then(syms => setAllSymbols(syms));
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allSymbols.filter(s => !alreadyPinned.includes(s)).slice(0, 12);
    return allSymbols
      .filter(s => s.includes(q) && !alreadyPinned.includes(s))
      .sort((a, b) => {
        // Exact prefix match first
        const aStarts = a.startsWith(q) ? 0 : 1;
        const bStarts = b.startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 12);
  }, [query, allSymbols, alreadyPinned]);

  useEffect(() => { setHighlighted(0); }, [results]);

  const commit = (sym: string) => {
    if (sym) onAdd(sym);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { if (results[highlighted]) commit(results[highlighted]); else if (query.trim()) commit(query.trim().toUpperCase()); }
    else if (e.key === "Escape") onClose();
  };

  return (
    <div style={{ padding: "4px 8px 6px" }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value.toUpperCase())}
        onKeyDown={handleKey}
        placeholder="Search symbol…"
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 0,
          color: "#FFFFFF",
          fontFamily: FONT_MONO,
          fontSize: "11px",
          padding: "4px 6px",
          outline: "none",
        }}
        onFocus={e => (e.currentTarget.style.borderColor = "#C41E3A")}
        onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)")}
      />
      {results.length > 0 && (
        <div style={{ marginTop: "2px", background: "#0B1F3A", border: "1px solid rgba(255,255,255,0.12)" }}>
          {results.map((sym, i) => (
            <button
              key={sym}
              onClick={() => commit(sym)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "4px 8px",
                background: i === highlighted ? "rgba(196,30,58,0.18)" : "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: FONT_MONO,
                fontSize: "11px",
                fontWeight: 600,
                color: i === highlighted ? "#FFFFFF" : "rgba(255,255,255,0.7)",
                letterSpacing: "0.04em",
              }}
            >
              {sym}
            </button>
          ))}
        </div>
      )}
      {allSymbols.length === 0 && (
        <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", padding: "4px 2px", fontFamily: FONT_BODY }}>Loading…</p>
      )}
    </div>
  );
}

// Module-level symbol cache — fetched once per page load, never refetched
let _symbolCache: string[] | null = null;
async function loadSymbols(): Promise<string[]> {
  if (_symbolCache) return _symbolCache;
  try {
    const [sp500Res, nasdaqRes] = await Promise.all([
      fetch("/api/sp500/symbols"),
      fetch("/api/nasdaq/symbols"),
    ]);
    const sp500Data  = await sp500Res.json();
    const nasdaqData = await nasdaqRes.json();
    const sp500  = (sp500Data.symbols  as string[]) ?? [];
    const nasdaq = (nasdaqData.symbols as string[]) ?? [];
    const merged = [...new Set([...sp500, ...nasdaq])].sort();
    _symbolCache = merged;
  } catch {
    _symbolCache = [];
  }
  return _symbolCache!;
}
