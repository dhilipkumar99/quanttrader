"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { marketApi } from "@/lib/marketApi";
import { api } from "@/lib/api";
import type { SP500Quote, WatchlistItem } from "@/types/quant";
import { cn } from "@/lib/utils";
import { RefreshCw, Search, Zap } from "lucide-react";

// ── Windowed table — only renders visible rows + a small buffer ───────────────
// This keeps DOM nodes ~constant regardless of total dataset size.
const ROW_HEIGHT = 33; // px per row
const WINDOW_BUFFER = 10; // extra rows above/below viewport

function VirtualTable({
  rows,
  onSelect,
  SignalBadge,
}: {
  rows: SP500Quote[];
  onSelect: (sym: string) => void;
  signals: Record<string, WatchlistItem>;
  SignalBadge: (props: { sym: string }) => React.ReactElement | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const containerHeight = 520; // px — fixed viewport

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - WINDOW_BUFFER);
  const endIdx   = Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + WINDOW_BUFFER);
  const visibleRows = rows.slice(startIdx, endIdx);

  return (
    <div
      ref={containerRef}
      style={{ height: `${containerHeight}px`, overflowY: "auto", position: "relative" }}
      onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      {/* Total height spacer */}
      <div style={{ height: `${totalHeight}px`, position: "relative" }}>
        {/* Visible row block */}
        <div style={{ position: "absolute", top: `${startIdx * ROW_HEIGHT}px`, left: 0, right: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <tbody>
              {visibleRows.map((q) => {
                const up        = q.change_pct >= 0;
                const intensity = Math.min(Math.abs(q.change_pct) / 3, 1);
                return (
                  <tr
                    key={q.symbol}
                    style={{ cursor: "pointer", height: `${ROW_HEIGHT}px`, borderBottom: "1px solid var(--border)" }}
                    onClick={() => onSelect(q.symbol)}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ width: "90px", textAlign: "left", paddingLeft: "12px" }}>
                      <span style={{ fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{q.symbol}</span>
                    </td>
                    <td style={{ width: "56px", fontSize: "10px", color: "var(--text-muted)", fontFamily: "'Palatino Linotype',serif" }}>
                      {SECTOR_MAP[q.symbol] ?? "—"}
                    </td>
                    <td style={{ width: "72px", textAlign: "right", fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "11px", color: "var(--text-primary)" }}>
                      ${q.price.toFixed(2)}
                    </td>
                    <td style={{ width: "72px", textAlign: "right" }}>
                      <span style={{ fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "11px", fontWeight: 600, color: up ? "var(--green)" : "var(--red)" }}>
                        {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ width: "76px", textAlign: "right", fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "10px", color: "var(--text-secondary)" }}>
                      {q.volume > 1_000_000 ? `${(q.volume / 1_000_000).toFixed(1)}M` : q.volume.toLocaleString()}
                    </td>
                    <td style={{ width: "80px", textAlign: "right", fontFamily: "'SF Mono','Fira Code',monospace", fontSize: "10px", color: "var(--text-secondary)" }}>
                      {q.market_cap >= 1e12 ? `$${(q.market_cap / 1e12).toFixed(2)}T` : q.market_cap >= 1e9 ? `$${(q.market_cap / 1e9).toFixed(1)}B` : "—"}
                    </td>
                    <td style={{ width: "56px" }}>
                      <div style={{
                        display: "inline-block", width: "48px", height: "14px",
                        background: up ? `rgba(0,212,170,${intensity * 0.7 + 0.1})` : `rgba(255,71,87,${intensity * 0.7 + 0.1})`,
                      }} />
                    </td>
                    <td style={{ width: "96px" }} onClick={e => e.stopPropagation()}>
                      <SignalBadge sym={q.symbol} />
                    </td>
                    <td style={{ width: "72px", textAlign: "right", paddingRight: "12px" }}>
                      <span style={{ color: "var(--blue)", fontSize: "10px" }}>Analyse →</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface Props { onSelectSymbol: (s: string) => void; }

type SortKey = "symbol" | "price" | "change_pct" | "volume" | "market_cap" | "signal";
type SortDir = "asc" | "desc";
type Filter  = "all" | "gainers" | "losers" | "flat" | "long" | "short";

const SECTOR_MAP: Record<string, string> = {
  AAPL:"Tech",MSFT:"Tech",NVDA:"Tech",AMZN:"Cons",GOOGL:"Comm",META:"Comm",TSLA:"Auto",
  JPM:"Fin",V:"Fin",JNJ:"Health",XOM:"Energy",UNH:"Health",PG:"Staples",HD:"Cons",
  BAC:"Fin",MA:"Fin",ABBV:"Health",KO:"Staples",PEP:"Staples",AVGO:"Tech",
  LLY:"Health",MRK:"Health",COST:"Staples",WMT:"Staples",CVX:"Energy",
  CRM:"Tech",ORCL:"Tech",NFLX:"Comm",ADBE:"Tech",CSCO:"Tech",INTC:"Tech",
  AMD:"Tech",QCOM:"Tech",TXN:"Tech",MU:"Tech",AMAT:"Tech",LRCX:"Tech",KLAC:"Tech",
};

// Map signal int → sortable number
function signalOrder(sig: number | undefined): number {
  if (sig === 1)  return 2;
  if (sig === -1) return 0;
  return 1; // FLAT / unknown
}

export function SP500Scanner({ onSelectSymbol }: Props) {
  const [quotes,      setQuotes]      = useState<SP500Quote[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState<Filter>("all");
  const [sortKey,     setSortKey]     = useState<SortKey>("market_cap");
  const [sortDir,     setSortDir]     = useState<SortDir>("desc");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // signal overlay: symbol → WatchlistItem
  const [signals,       setSignals]       = useState<Record<string, WatchlistItem>>({});
  const [signalLoading, setSignalLoading] = useState(false);
  const [signalProgress, setSignalProgress] = useState(0); // 0–100
  const refreshTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await marketApi.sp500Quotes("market_cap", 503);
      setQuotes(data.quotes ?? []);
      setLastRefresh(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshTimer.current = setInterval(load, 30_000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    return quotes
      .filter(q => {
        if (search && !q.symbol.includes(search.toUpperCase())) return false;
        if (filter === "gainers") return q.change_pct > 0.5;
        if (filter === "losers")  return q.change_pct < -0.5;
        if (filter === "flat")    return Math.abs(q.change_pct) <= 0.5;
        if (filter === "long")  return signals[q.symbol]?.signal === 1;
        if (filter === "short") return signals[q.symbol]?.signal === -1;
        return true;
      })
      .sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        if (sortKey === "signal") {
          return (signalOrder(signals[a.symbol]?.signal) -
                  signalOrder(signals[b.symbol]?.signal)) * mul;
        }
        const av = a[sortKey as Exclude<SortKey, "signal">];
        const bv = b[sortKey as Exclude<SortKey, "signal">];
        return typeof av === "string"
          ? av.localeCompare(String(bv)) * mul
          : ((av as number) - (bv as number)) * mul;
      });
  }, [quotes, search, filter, sortKey, sortDir, signals]);

  // Batch-load signals in groups of 10 for given symbol list
  const loadSignalBatch = useCallback(async (syms: string[]) => {
    if (!syms.length) return;
    setSignalLoading(true);
    setSignalProgress(0);
    const BATCH = 10;
    for (let i = 0; i < syms.length; i += BATCH) {
      const batch = syms.slice(i, i + BATCH);
      try {
        const data = await api.watchlist(batch);
        const map: Record<string, WatchlistItem> = {};
        for (const item of data.watchlist) map[item.symbol] = item;
        setSignals(prev => ({ ...prev, ...map }));
      } catch { /* non-critical — continue next batch */ }
      setSignalProgress(Math.round(((i + BATCH) / syms.length) * 100));
    }
    setSignalLoading(false);
    setSignalProgress(100);
  }, []);

  // Auto-warm: top 20 by market cap as soon as quotes arrive (once per mount)
  useEffect(() => {
    if (quotes.length > 0 && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      const top20 = quotes.slice(0, 20).map(q => q.symbol);
      loadSignalBatch(top20);
    }
  }, [quotes, loadSignalBatch]);

  // Manual "Load More" — next 80 (total 100)
  const loadMore = useCallback(() => {
    const already = new Set(Object.keys(signals));
    const next = quotes.filter(q => !already.has(q.symbol)).slice(0, 80).map(q => q.symbol);
    loadSignalBatch(next);
  }, [quotes, signals, loadSignalBatch]);

  // Stats
  const gainers = quotes.filter(q => q.change_pct > 0).length;
  const losers  = quotes.filter(q => q.change_pct < 0).length;
  const flat    = quotes.length - gainers - losers;
  const avgChg  = quotes.length ? quotes.reduce((s, q) => s + q.change_pct, 0) / quotes.length : 0;
  const longSig  = Object.values(signals).filter(s => s.signal === 1).length;
  const shortSig = Object.values(signals).filter(s => s.signal === -1).length;

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className="flex items-center gap-0.5 hover:text-white transition-colors">
      {label}
      {sortKey === k && <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );

  function SignalBadge({ sym }: { sym: string }) {
    const item = signals[sym];
    if (!item) return <span style={{ color: "var(--text-disabled)", fontSize: "10px" }}>—</span>;
    const sig  = item.signal;
    const conf = Math.round((item.confidence ?? 0) * 100);
    if (sig === 1)  return (
      <span style={{ color: "var(--green)", fontSize: "10px", fontWeight: 700 }}>
        ▲ LONG <span style={{ fontWeight: 400 }}>{conf}%</span>
      </span>
    );
    if (sig === -1) return (
      <span style={{ color: "var(--red)", fontSize: "10px", fontWeight: 700 }}>
        ▼ SHORT <span style={{ fontWeight: 400 }}>{conf}%</span>
      </span>
    );
    return <span style={{ color: "var(--yellow)", fontSize: "10px" }}>◆ FLAT</span>;
  }

  return (
    <div className="space-y-3">
      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "S&P 500 Stocks",  value: `${quotes.length}/503` },
          { label: "Advancing",       value: gainers, color: "var(--green)" },
          { label: "Declining",       value: losers,  color: "var(--red)" },
          { label: "Avg Change",      value: `${avgChg >= 0 ? "+" : ""}${avgChg.toFixed(2)}%`, color: avgChg >= 0 ? "var(--green)" : "var(--red)" },
        ].map(item => (
          <div key={item.label} className="panel p-2">
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{item.label}</div>
            <div className="text-lg font-bold num mt-0.5" style={{ color: (item as { color?: string }).color ?? "var(--text-primary)" }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="panel">
        <div className="panel-header">
          <span>S&P 500 Real-Time Scanner</span>
          <div className="flex items-center gap-3">
            {/* Signal status / load more */}
            <div className="flex items-center gap-2">
              {signalLoading ? (
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 animate-pulse" style={{ color: "var(--blue)" }} />
                  <div>
                    <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                      Scanning… {signalProgress}%
                    </div>
                    <div className="h-0.5 w-24 mt-0.5" style={{ background: "var(--bg-active)" }}>
                      <div style={{ width: `${signalProgress}%`, height: "100%", background: "var(--blue)", transition: "width 0.3s" }} />
                    </div>
                  </div>
                </div>
              ) : Object.keys(signals).length > 0 ? (
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--green)", fontWeight: 700 }}>{longSig}L</span>
                    {" · "}
                    <span style={{ color: "var(--red)", fontWeight: 700 }}>{shortSig}S</span>
                    {" · "}
                    <span style={{ color: "var(--text-disabled)" }}>{Object.keys(signals).length} scanned</span>
                  </span>
                  {Object.keys(signals).length < 100 && (
                    <button
                      onClick={loadMore}
                      className="flex items-center gap-1 px-2 py-0.5 text-[9px]"
                      style={{ background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue)44" }}
                    >
                      <Zap className="h-2.5 w-2.5" /> Load more
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {lastRefresh && (
              <span style={{ color: "var(--text-muted)" }} className="text-[10px]">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button onClick={load} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors">
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <div className="flex items-center gap-1.5">
            <Search className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter symbol…"
              className="et-input w-28 text-xs"
              style={{ padding: "2px 6px" }}
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all","gainers","losers","flat","long","short"] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-2.5 py-1 text-[10px] font-medium transition-colors capitalize"
                style={{
                  background: filter === f ? "var(--blue-dim)" : "transparent",
                  color: filter === f ? "var(--blue)" : "var(--text-muted)",
                  border: `1px solid ${filter === f ? "var(--blue)" : "var(--border)"}`,
                }}
              >
                {f === "all"     ? `All (${quotes.length})` :
                 f === "gainers" ? `▲ Gainers (${gainers})` :
                 f === "losers"  ? `▼ Losers (${losers})` :
                 f === "flat"    ? `= Flat (${flat})` :
                 f === "long"    ? `▲ Long (${longSig})` :
                                   `▼ Short (${shortSig})`}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
            Showing {filtered.length} stocks · auto-refresh 30s
          </span>
        </div>

        {/* Virtualized table */}
        <div>
          {/* Column headers (fixed — always visible) */}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "var(--bg-raised)", borderBottom: "2px solid var(--border)" }}>
                <th style={{ width: "90px", textAlign: "left", paddingLeft: "12px", padding: "7px 8px 7px 12px" }}><SortBtn k="symbol" label="Symbol" /></th>
                <th style={{ width: "56px", textAlign: "left", padding: "7px 8px", fontFamily: "'Palatino Linotype',serif", fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Sector</th>
                <th style={{ width: "72px", textAlign: "right", padding: "7px 8px" }}><SortBtn k="price" label="Price" /></th>
                <th style={{ width: "72px", textAlign: "right", padding: "7px 8px" }}><SortBtn k="change_pct" label="Chg %" /></th>
                <th style={{ width: "76px", textAlign: "right", padding: "7px 8px" }}><SortBtn k="volume" label="Volume" /></th>
                <th style={{ width: "80px", textAlign: "right", padding: "7px 8px" }}><SortBtn k="market_cap" label="Mkt Cap" /></th>
                <th style={{ width: "56px", padding: "7px 8px", fontFamily: "'Palatino Linotype',serif", fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Heat</th>
                <th style={{ width: "96px", padding: "7px 8px" }}><SortBtn k="signal" label="Signal" /></th>
                <th style={{ width: "72px", padding: "7px 12px 7px 8px" }}></th>
              </tr>
            </thead>
          </table>

          {loading && quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw className="h-5 w-5 animate-spin" style={{ color: "var(--text-muted)" }} />
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading all 503 S&P 500 stocks…</div>
              <div className="text-xs" style={{ color: "var(--text-disabled)" }}>This takes ~5s on first load</div>
            </div>
          ) : (
            <>
              <VirtualTable
                rows={filtered}
                onSelect={onSelectSymbol}
                signals={signals}
                SignalBadge={SignalBadge}
              />
              <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)", background: "var(--bg-raised)" }}>
                Showing {filtered.length} stocks · scroll to browse all · auto-refresh 30s
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
