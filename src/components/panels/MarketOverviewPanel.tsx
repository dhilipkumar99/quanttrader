"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { IndicesStrip } from "@/components/market/IndicesStrip";
import { SectorHeatmap } from "@/components/market/SectorHeatmap";
import { OrderBookLadder } from "@/components/market/OrderBookLadder";
import { PriceTicker } from "@/components/ui/PriceTicker";
import { marketApi } from "@/lib/marketApi";
import type { SP500Quote } from "@/types/quant";
import { RefreshCw, TrendingUp, TrendingDown, Search, BarChart2 } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

interface Props {
  onSelectSymbol: (sym: string) => void;
  onGoToAnalysis: (sym: string) => void;
}

type MoverTab = "gainers" | "losers" | "all";
type SortKey  = "change_pct" | "price" | "volume" | "market_cap" | "symbol";
type SortDir  = "asc" | "desc";

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMktCap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  return "—";
}
function fmtVol(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
}

const SECTOR_MAP: Record<string, string> = {
  AAPL:"Tech",MSFT:"Tech",NVDA:"Tech",AMZN:"Cons",GOOGL:"Comm",META:"Comm",TSLA:"Auto",
  JPM:"Fin",V:"Fin","BRK-B":"Fin",UNH:"Health",XOM:"Energy",LLY:"Health",JNJ:"Health",
  PG:"Staples",MA:"Fin",HD:"Cons",MRK:"Health",AVGO:"Tech",CVX:"Energy",
  COST:"Staples",ABBV:"Health",PEP:"Staples",KO:"Staples",WMT:"Staples",
  BAC:"Fin",TMO:"Health",ACN:"Tech",CRM:"Tech",NFLX:"Comm",ORCL:"Tech",
  ADBE:"Tech",CSCO:"Tech",INTC:"Tech",AMD:"Tech",QCOM:"Tech",TXN:"Tech",
  MU:"Tech",AMAT:"Tech",LRCX:"Tech",KLAC:"Tech",INTU:"Tech",NOW:"Tech",
  ISRG:"Health",REGN:"Health",VRTX:"Health",GILD:"Health",MRNA:"Health",
  GS:"Fin",MS:"Fin",WFC:"Fin",C:"Fin",AXP:"Fin",
  RTX:"Indust",HON:"Indust",CAT:"Indust",DE:"Indust",GE:"Indust",UPS:"Indust",
  NEE:"Util",DUK:"Util",SO:"Util",
  PLD:"RE",AMT:"RE",EQIX:"RE",
};

// ── Full-width movers table ───────────────────────────────────────────────────

function MoversTable({ onSelect }: { onSelect: (sym: string) => void }) {
  const [quotes,    setQuotes]   = useState<SP500Quote[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [tab,       setTab]      = useState<MoverTab>("gainers");
  const [search,    setSearch]   = useState("");
  const [sortKey,   setSortKey]  = useState<SortKey>("change_pct");
  const [sortDir,   setSortDir]  = useState<SortDir>("desc");
  const [page,      setPage]     = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    try {
      const data = await marketApi.sp500Quotes("market_cap", 503);
      setQuotes(data.quotes ?? []);
      setLastRefresh(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "symbol" ? "asc" : "desc"); }
    setPage(0);
  };

  const filtered = useMemo(() => {
    let list = quotes;
    if (search) list = list.filter(q => q.symbol.includes(search.toUpperCase()));
    if (tab === "gainers") list = list.filter(q => q.change_pct > 0);
    if (tab === "losers")  list = list.filter(q => q.change_pct < 0);
    return [...list].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey as keyof SP500Quote];
      const bv = b[sortKey as keyof SP500Quote];
      return typeof av === "string" ? (av as string).localeCompare(bv as string) * mul
                                    : ((av as number) - (bv as number)) * mul;
    });
  }, [quotes, search, tab, sortKey, sortDir]);

  const page_items = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const total_pages = Math.ceil(filtered.length / PAGE_SIZE);

  const gainers = quotes.filter(q => q.change_pct > 0).length;
  const losers  = quotes.filter(q => q.change_pct < 0).length;
  const avgChg  = quotes.length ? quotes.reduce((s, q) => s + q.change_pct, 0) / quotes.length : 0;
  const topGainer = quotes.reduce((best, q) => q.change_pct > (best?.change_pct ?? -Infinity) ? q : best, quotes[0]);
  const topLoser  = quotes.reduce((best, q) => q.change_pct < (best?.change_pct ?? Infinity) ? q : best, quotes[0]);

  const SortBtn = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        textAlign: align as "left" | "right",
        cursor: "pointer",
        padding: "7px 10px",
        fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
        letterSpacing: "0.14em", textTransform: "uppercase",
        color: sortKey === k ? "var(--text-primary)" : "var(--text-muted)",
        whiteSpace: "nowrap", userSelect: "none",
        background: "var(--bg-raised)",
        borderBottom: "2px solid var(--border)",
      }}
    >
      {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <div className="panel-header" style={{ flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <BarChart2 className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
          <span>S&P 500 — All Movers</span>
          {lastRefresh && (
            <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)" }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid var(--border)", padding: "2px 6px" }}>
            <Search style={{ width: "10px", height: "10px", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filter…"
              style={{
                fontFamily: FONT_MONO, fontSize: "11px", width: "80px",
                background: "transparent", border: "none", outline: "none",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <button
            onClick={load}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: 0, borderBottom: "1px solid var(--border)",
      }}>
        {[
          { label: "Advancing", value: gainers, color: "#1A6B4A", sub: `${((gainers / Math.max(quotes.length, 1)) * 100).toFixed(0)}%` },
          { label: "Declining",  value: losers,  color: "#C41E3A", sub: `${((losers / Math.max(quotes.length, 1)) * 100).toFixed(0)}%` },
          { label: "Avg Change", value: `${avgChg >= 0 ? "+" : ""}${avgChg.toFixed(2)}%`, color: avgChg >= 0 ? "#1A6B4A" : "#C41E3A", sub: `${quotes.length} stocks` },
          { label: "Breadth",    value: gainers > losers ? "Bullish" : gainers < losers ? "Bearish" : "Neutral",
            color: gainers > losers ? "#1A6B4A" : "#C41E3A",
            sub: topGainer ? `Top: ${topGainer.symbol} +${topGainer.change_pct.toFixed(1)}%` : "" },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ padding: "8px 12px", borderRight: "1px solid var(--border)" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "15px", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Tab + pagination bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
        padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)",
      }}>
        {(["gainers", "all", "losers"] as MoverTab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(0); }}
            style={{
              fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "3px 10px",
              background: tab === t ? (t === "gainers" ? "rgba(26,107,74,0.15)" : t === "losers" ? "rgba(196,30,58,0.15)" : "var(--bg-active)") : "transparent",
              color: tab === t ? (t === "gainers" ? "#1A6B4A" : t === "losers" ? "#C41E3A" : "var(--text-primary)") : "var(--text-muted)",
              border: `1px solid ${tab === t ? (t === "gainers" ? "#1A6B4A44" : t === "losers" ? "#C41E3A44" : "var(--border)") : "var(--border)"}`,
              cursor: "pointer",
            }}
          >
            {t === "gainers" ? `▲ Gainers (${gainers})` : t === "losers" ? `▼ Losers (${losers})` : `All (${quotes.length})`}
          </button>
        ))}
        <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} stocks · page {page + 1}/{total_pages}
        </span>
        <div style={{ display: "flex", gap: "2px" }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              fontFamily: FONT_MONO, fontSize: "10px", padding: "2px 8px",
              background: "var(--bg-raised)", border: "1px solid var(--border)",
              color: page === 0 ? "var(--text-muted)" : "var(--text-primary)",
              cursor: page === 0 ? "not-allowed" : "pointer",
            }}
          >←</button>
          <button
            onClick={() => setPage(p => Math.min(total_pages - 1, p + 1))}
            disabled={page >= total_pages - 1}
            style={{
              fontFamily: FONT_MONO, fontSize: "10px", padding: "2px 8px",
              background: "var(--bg-raised)", border: "1px solid var(--border)",
              color: page >= total_pages - 1 ? "var(--text-muted)" : "var(--text-primary)",
              cursor: page >= total_pages - 1 ? "not-allowed" : "pointer",
            }}
          >→</button>
        </div>
      </div>

      {/* Table */}
      {loading && quotes.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "32px" }}>
          <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--text-muted)" }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>
            Loading S&P 500 quotes…
          </span>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "7px 10px 7px 14px", textAlign: "left", fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                  onClick={() => toggleSort("symbol")}>
                  Symbol{sortKey === "symbol" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" }}>
                  Sector
                </th>
                <SortBtn k="price"      label="Price" />
                <SortBtn k="change_pct" label="Change %" />
                <th style={{ padding: "7px 10px", textAlign: "left", fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" }}>
                  Move
                </th>
                <SortBtn k="volume"     label="Volume" />
                <SortBtn k="market_cap" label="Mkt Cap" />
                <th style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)", paddingRight: "14px" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {page_items.map(q => {
                const up = q.change_pct >= 0;
                const absPct = Math.abs(q.change_pct);
                const intensity = Math.min(absPct / 5, 1);
                return (
                  <tr
                    key={q.symbol}
                    style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                    onClick={() => onSelect(q.symbol)}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "7px 10px 7px 14px" }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
                        {q.symbol}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.08em" }}>
                        {SECTOR_MAP[q.symbol] ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-primary)" }}>
                        {fmt$(q.price)}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: up ? "#1A6B4A" : "#C41E3A" }}>
                        {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <div style={{
                        width: `${Math.max(4, Math.round(intensity * 64))}px`,
                        height: "12px",
                        background: up
                          ? `rgba(26,107,74,${0.15 + intensity * 0.6})`
                          : `rgba(196,30,58,${0.15 + intensity * 0.6})`,
                        minWidth: "4px",
                      }} />
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "10px", color: "var(--text-secondary)" }}>
                        {fmtVol(q.volume)}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "10px", color: "var(--text-secondary)" }}>
                        {fmtMktCap(q.market_cap)}
                      </span>
                    </td>
                    <td style={{ padding: "7px 14px 7px 10px", textAlign: "right" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, color: "var(--blue)", letterSpacing: "0.08em" }}>
                        Analyse →
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom pagination */}
      {total_pages > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--bg-raised)",
        }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)" }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: "flex", gap: "2px" }}>
            {Array.from({ length: Math.min(total_pages, 10) }).map((_, i) => {
              const pageNum = total_pages <= 10 ? i : i;
              return (
                <button
                  key={i}
                  onClick={() => setPage(pageNum)}
                  style={{
                    fontFamily: FONT_MONO, fontSize: "9px", padding: "2px 6px",
                    background: page === pageNum ? "var(--text-primary)" : "var(--bg-raised)",
                    color: page === pageNum ? "var(--bg-base)" : "var(--text-muted)",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  {pageNum + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setPage(p => Math.min(total_pages - 1, p + 1))}
            disabled={page >= total_pages - 1}
            style={{
              fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, padding: "3px 10px",
              background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue)44",
              cursor: page >= total_pages - 1 ? "not-allowed" : "pointer",
            }}
          >
            Next page →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Top gainers / losers hero strip ──────────────────────────────────────────

function MoverHeroStrip({ onSelect }: { onSelect: (sym: string) => void }) {
  const [data, setData] = useState<{ gainers: { symbol: string; price: number; change_pct: number }[]; losers: { symbol: string; price: number; change_pct: number }[] }>({ gainers: [], losers: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    marketApi.sp500Quotes("market_cap", 503)
      .then(d => {
        const sorted = [...(d.quotes ?? [])].sort((a, b) => b.change_pct - a.change_pct);
        setData({ gainers: sorted.slice(0, 8), losers: sorted.slice(-8).reverse() });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", gap: "6px" }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ flex: 1, height: "56px", background: "var(--bg-raised)", border: "1px solid var(--border)" }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header">
        <span>Top Movers</span>
        <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)" }}>best and worst performers today</span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", gap: "6px", overflowX: "auto" }}>
        {data.gainers.map(q => (
          <button
            key={q.symbol}
            onClick={() => onSelect(q.symbol)}
            style={{
              flex: "0 0 auto", minWidth: "80px",
              padding: "8px 10px",
              background: "rgba(26,107,74,0.08)",
              border: "1px solid rgba(26,107,74,0.3)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
              {q.symbol}
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700, color: "#1A6B4A" }}>
              +{q.change_pct.toFixed(2)}%
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              ${q.price.toFixed(2)}
            </div>
          </button>
        ))}
        <div style={{ width: "1px", background: "var(--border)", flexShrink: 0 }} />
        {data.losers.map(q => (
          <button
            key={q.symbol}
            onClick={() => onSelect(q.symbol)}
            style={{
              flex: "0 0 auto", minWidth: "80px",
              padding: "8px 10px",
              background: "rgba(196,30,58,0.08)",
              border: "1px solid rgba(196,30,58,0.3)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
              {q.symbol}
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700, color: "#C41E3A" }}>
              {q.change_pct.toFixed(2)}%
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              ${q.price.toFixed(2)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MarketOverviewPanel({ onSelectSymbol, onGoToAnalysis }: Props) {
  const [bookSymbol, setBookSymbol] = useState("AAPL");

  const handleSelect = (sym: string) => {
    setBookSymbol(sym);
    onGoToAnalysis(sym);
    onSelectSymbol(sym);
  };

  return (
    <div className="space-y-3">
      {/* Indices strip */}
      <IndicesStrip />

      {/* Live price ticker for active book symbol */}
      <PriceTicker symbol={bookSymbol} initialPrice={0} initialChangePct={0} />

      {/* Sector heatmap */}
      <SectorHeatmap />

      {/* Hero movers strip */}
      <MoverHeroStrip onSelect={handleSelect} />

      {/* Full SP500 movers table */}
      <MoversTable onSelect={handleSelect} />

      {/* Order book */}
      <div className="panel overflow-hidden">
        <div className="panel-header">
          <span>L2 Order Book</span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)" }}>symbol:</span>
            <input
              type="text"
              value={bookSymbol}
              onChange={(e) => setBookSymbol(e.target.value.toUpperCase())}
              style={{
                fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600,
                width: "72px", padding: "2px 6px",
                border: "1px solid var(--border)", background: "var(--bg-surface)",
                color: "var(--text-primary)", outline: "none",
                textTransform: "uppercase",
              }}
              placeholder="AAPL"
            />
          </div>
        </div>
        <div style={{ padding: "8px" }}>
          <OrderBookLadder symbol={bookSymbol} refreshMs={5000} />
        </div>
      </div>
    </div>
  );
}
