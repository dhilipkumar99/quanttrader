"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { marketApi } from "@/lib/marketApi";
import { api } from "@/lib/api";
import type { WatchlistItem } from "@/types/quant";
import { RefreshCw, Search, Zap, TrendingUp, TrendingDown, Activity } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScanRow {
  symbol: string;
  price: number;
  change_pct: number;
  volume: number;
  market_cap: number;
  universe: string;
  rs_rank: number;   // 0–100 percentile of change_pct within universe
  vol_surge: number; // today vol / median vol
}

type SortKey = "symbol" | "price" | "change_pct" | "volume" | "market_cap" | "signal" | "rs_rank" | "vol_surge";
type SortDir = "asc" | "desc";
type Universe = "both" | "sp500" | "nasdaq";
type Filter = "all" | "gainers" | "losers" | "vol_surge" | "long" | "short" | "overbought" | "oversold";

const MONO = "'SF Mono','Fira Code',monospace";
const SERIF = "'Palatino Linotype',Palatino,serif";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtMktCap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  return "—";
}
function fmtVol(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
}

// ── Sector lookup ─────────────────────────────────────────────────────────────

const SECTOR: Record<string, string> = {
  AAPL:"Tech",MSFT:"Tech",NVDA:"Tech",AMZN:"Cons",GOOGL:"Comm",META:"Comm",TSLA:"Auto",
  JPM:"Fin",V:"Fin","BRK-B":"Fin",UNH:"Health",XOM:"Energy",LLY:"Health",JNJ:"Health",
  PG:"Staples",MA:"Fin",HD:"Cons",MRK:"Health",AVGO:"Tech",CVX:"Energy",
  COST:"Staples",ABBV:"Health",PEP:"Staples",KO:"Staples",WMT:"Staples",
  BAC:"Fin",TMO:"Health",CRM:"Tech",NFLX:"Comm",ORCL:"Tech",ADBE:"Tech",
  CSCO:"Tech",INTC:"Tech",AMD:"Tech",QCOM:"Tech",TXN:"Tech",MU:"Tech",
  GS:"Fin",MS:"Fin",WFC:"Fin",C:"Fin",RTX:"Indust",HON:"Indust",CAT:"Indust",
  ZM:"Tech",DOCU:"Tech",TWLO:"Tech",OKTA:"Tech",NET:"Tech",SNOW:"Tech",
  MDB:"Tech",ZS:"Tech",SHOP:"Tech",ROKU:"Tech",SPOT:"Comm",
};

// ── RS rank badge ─────────────────────────────────────────────────────────────

function RsBadge({ rank }: { rank: number }) {
  const color = rank >= 80 ? "#1A6B4A" : rank >= 60 ? "#B45309" : rank <= 20 ? "#C41E3A" : "var(--text-muted)";
  const label = rank >= 80 ? "Strong" : rank >= 60 ? "Above Avg" : rank <= 20 ? "Weak" : "Avg";
  return (
    <span style={{
      fontFamily: MONO, fontSize: "9px", fontWeight: 600,
      color, padding: "1px 5px",
      border: `1px solid ${color}44`,
      background: `${color}11`,
    }}>
      {label} {rank.toFixed(0)}
    </span>
  );
}

// ── Vol surge badge ───────────────────────────────────────────────────────────

function VolBadge({ surge }: { surge: number }) {
  if (surge < 1.5) return null;
  const hot = surge >= 3;
  return (
    <span style={{
      fontFamily: SERIF, fontSize: "8px", fontWeight: 600,
      color: hot ? "#B45309" : "#6B5F52",
      padding: "1px 4px",
      border: `1px solid ${hot ? "#B4530944" : "var(--border)"}`,
      background: hot ? "rgba(180,83,9,0.08)" : "var(--bg-raised)",
      marginLeft: "3px",
    }}>
      {surge.toFixed(1)}× vol
    </span>
  );
}

// ── Signal badge (from watchlist enrichment) ──────────────────────────────────

function SignalBadge({ item }: { item: WatchlistItem | undefined }) {
  if (!item) return <span style={{ color: "var(--text-disabled)", fontSize: "10px" }}>—</span>;
  const conf = Math.round((item.confidence ?? 0) * 100);
  if (item.signal === 1) return (
    <span style={{ fontFamily: MONO, fontSize: "10px", fontWeight: 700, color: "var(--green)" }}>
      ▲ LONG <span style={{ fontWeight: 400, opacity: 0.8 }}>{conf}%</span>
    </span>
  );
  if (item.signal === -1) return (
    <span style={{ fontFamily: MONO, fontSize: "10px", fontWeight: 700, color: "var(--red)" }}>
      ▼ SHORT <span style={{ fontWeight: 400, opacity: 0.8 }}>{conf}%</span>
    </span>
  );
  return <span style={{ color: "var(--yellow)", fontSize: "10px" }}>◆ FLAT</span>;
}

// ── Breadth arc (simple SVG arc for advancing/declining) ──────────────────────

function BreadthArc({ pct, color }: { pct: number; color: string }) {
  const r = 18; const cx = 24; const cy = 24;
  const angle = (pct / 100) * 2 * Math.PI;
  const x = cx + r * Math.sin(angle - Math.PI);
  const y = cy - r * Math.cos(angle - Math.PI);
  const large = pct > 50 ? 1 : 0;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}`}
        fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fontFamily={MONO} fill={color} fontWeight="700">
        {pct.toFixed(0)}%
      </text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onSelectSymbol: (s: string) => void;
  serverReady?: boolean;
}

export function SP500Scanner({ onSelectSymbol, serverReady = true }: Props) {
  const [quotes,         setQuotes]         = useState<ScanRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [universe,       setUniverse]       = useState<Universe>("both");
  const [search,         setSearch]         = useState("");
  const [filter,         setFilter]         = useState<Filter>("all");
  const [sortKey,        setSortKey]        = useState<SortKey>("vol_surge");
  const [sortDir,        setSortDir]        = useState<SortDir>("desc");
  const [lastRefresh,    setLastRefresh]    = useState<Date | null>(null);
  const [signals,        setSignals]        = useState<Record<string, WatchlistItem>>({});
  const [signalLoading,  setSignalLoading]  = useState(false);
  const [signalProgress, setSignalProgress] = useState(0);
  const autoLoadedRef = useRef(false);

  const load = useCallback(async (uni: Universe = universe) => {
    setLoading(true);
    try {
      const data = await marketApi.scannerQuotes(uni, "volume", 1000);
      setQuotes(data.quotes ?? []);
      setLastRefresh(new Date());
    } catch {
      // silent — stale cache will serve
    } finally {
      setLoading(false);
    }
  }, [universe]);

  useEffect(() => {
    if (!serverReady) return; // don't fire into a sleeping Render
    load(universe);
    const id = setInterval(() => load(universe), 120_000);
    return () => clearInterval(id);
  }, [load, universe, serverReady]);

  // Auto-load ML signals for the top 30 by volume on first load
  useEffect(() => {
    if (quotes.length > 0 && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      const top30 = quotes.slice(0, 30).map(q => q.symbol);
      loadSignalBatch(top30);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

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
      } catch { /* non-critical */ }
      setSignalProgress(Math.round(((i + BATCH) / syms.length) * 100));
    }
    setSignalLoading(false);
    setSignalProgress(100);
  }, []);

  const loadMoreSignals = useCallback(() => {
    const already = new Set(Object.keys(signals));
    const next = quotes.filter(q => !already.has(q.symbol)).slice(0, 70).map(q => q.symbol);
    loadSignalBatch(next);
  }, [quotes, signals, loadSignalBatch]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    return quotes
      .filter(q => {
        if (search && !q.symbol.includes(search.toUpperCase())) return false;
        switch (filter) {
          case "gainers":   return q.change_pct > 0.5;
          case "losers":    return q.change_pct < -0.5;
          case "vol_surge": return q.vol_surge >= 2;
          case "long":      return signals[q.symbol]?.signal === 1;
          case "short":     return signals[q.symbol]?.signal === -1;
          case "overbought":return q.rs_rank >= 85;
          case "oversold":  return q.rs_rank <= 15;
          default:          return true;
        }
      })
      .sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        if (sortKey === "signal") {
          const sigOrder = (s: WatchlistItem | undefined) => s?.signal === 1 ? 2 : s?.signal === -1 ? 0 : 1;
          return (sigOrder(signals[a.symbol]) - sigOrder(signals[b.symbol])) * mul;
        }
        const av = a[sortKey as Exclude<SortKey, "signal">] ?? 0;
        const bv = b[sortKey as Exclude<SortKey, "signal">] ?? 0;
        return typeof av === "string" ? (av as string).localeCompare(bv as string) * mul : ((av as number) - (bv as number)) * mul;
      });
  }, [quotes, search, filter, sortKey, sortDir, signals]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const gainers   = quotes.filter(q => q.change_pct > 0).length;
  const losers    = quotes.filter(q => q.change_pct < 0).length;
  const volSurge  = quotes.filter(q => q.vol_surge >= 2).length;
  const avgChg    = quotes.length ? quotes.reduce((s, q) => s + q.change_pct, 0) / quotes.length : 0;
  const sp500ct   = quotes.filter(q => q.universe === "sp500").length;
  const nasdaqct  = quotes.filter(q => q.universe === "nasdaq").length;
  const longSig   = Object.values(signals).filter(s => s.signal === 1).length;
  const shortSig  = Object.values(signals).filter(s => s.signal === -1).length;
  const topGainer = quotes.reduce((b, q) => q.change_pct > (b?.change_pct ?? -Infinity) ? q : b, quotes[0] as ScanRow | undefined);
  const topLoser  = quotes.reduce((b, q) => q.change_pct < (b?.change_pct ?? Infinity) ? q : b, quotes[0] as ScanRow | undefined);
  const breadthPct = quotes.length ? (gainers / quotes.length) * 100 : 50;

  const SortTh = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        textAlign: align, cursor: "pointer", padding: "7px 10px",
        fontFamily: SERIF, fontSize: "9px", fontWeight: 600,
        letterSpacing: "0.14em", textTransform: "uppercase",
        color: sortKey === k ? "var(--text-primary)" : "var(--text-muted)",
        background: "var(--bg-raised)", borderBottom: "2px solid var(--border)",
        whiteSpace: "nowrap", userSelect: "none",
      }}
    >
      {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* ── Dashboard strip ────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "8px" }}>
        {/* Breadth arc */}
        <div className="panel" style={{ padding: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
          <BreadthArc pct={breadthPct} color={breadthPct >= 50 ? "#1A6B4A" : "#C41E3A"} />
          <div>
            <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "2px" }}>Market Breadth</div>
            <div style={{ fontFamily: MONO, fontSize: "13px", fontWeight: 700, color: breadthPct >= 50 ? "var(--green)" : "var(--red)" }}>
              {gainers}▲ / {losers}▼
            </div>
            <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>
              {breadthPct >= 50 ? "Bullish" : "Bearish"} breadth
            </div>
          </div>
        </div>

        {/* Avg change */}
        <div className="panel" style={{ padding: "12px" }}>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px" }}>Avg Move</div>
          <div style={{ fontFamily: MONO, fontSize: "18px", fontWeight: 700, color: avgChg >= 0 ? "var(--green)" : "var(--red)" }}>
            {avgChg >= 0 ? "+" : ""}{avgChg.toFixed(2)}%
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>
            {quotes.length} stocks tracked
          </div>
        </div>

        {/* Top mover */}
        <div className="panel" style={{ padding: "12px", cursor: "pointer" }} onClick={() => topGainer && onSelectSymbol(topGainer.symbol)}>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px" }}>Top Gainer</div>
          {topGainer ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>{topGainer.symbol}</div>
              <div style={{ fontFamily: MONO, fontSize: "13px", fontWeight: 700, color: "var(--green)" }}>+{topGainer.change_pct.toFixed(2)}%</div>
            </>
          ) : <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>—</div>}
        </div>

        {/* Top loser */}
        <div className="panel" style={{ padding: "12px", cursor: "pointer" }} onClick={() => topLoser && onSelectSymbol(topLoser.symbol)}>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px" }}>Top Loser</div>
          {topLoser ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>{topLoser.symbol}</div>
              <div style={{ fontFamily: MONO, fontSize: "13px", fontWeight: 700, color: "var(--red)" }}>{topLoser.change_pct.toFixed(2)}%</div>
            </>
          ) : <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>—</div>}
        </div>

        {/* Vol surge count */}
        <div className="panel" style={{ padding: "12px" }}>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px" }}>Vol Surges</div>
          <div style={{ fontFamily: MONO, fontSize: "18px", fontWeight: 700, color: volSurge > 10 ? "#B45309" : "var(--text-primary)" }}>
            {volSurge}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>≥2× median vol</div>
        </div>

        {/* ML signal count */}
        <div className="panel" style={{ padding: "12px" }}>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px" }}>ML Signals</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
            <span style={{ fontFamily: MONO, fontSize: "16px", fontWeight: 700, color: "var(--green)" }}>{longSig}L</span>
            <span style={{ fontFamily: MONO, fontSize: "16px", fontWeight: 700, color: "var(--red)" }}>{shortSig}S</span>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>
            {Object.keys(signals).length} scanned · {sp500ct} S&P / {nasdaqct} NQ
          </div>
        </div>
      </div>

      {/* ── Scanner table ───────────────────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        {/* Header */}
        <div className="panel-header" style={{ flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={13} style={{ color: "var(--text-muted)" }} />
            <span>Opportunity Scanner</span>
            {lastRefresh && (
              <span style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)" }}>
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto", flexWrap: "wrap" }}>
            {/* Universe tabs */}
            {(["both", "sp500", "nasdaq"] as Universe[]).map(u => (
              <button
                key={u}
                onClick={() => { setUniverse(u); autoLoadedRef.current = false; load(u); }}
                style={{
                  fontFamily: SERIF, fontSize: "9px", fontWeight: 600,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "3px 10px",
                  background: universe === u ? "var(--bg-active)" : "transparent",
                  color: universe === u ? "var(--text-primary)" : "var(--text-muted)",
                  border: `1px solid ${universe === u ? "var(--border)" : "transparent"}`,
                  cursor: "pointer",
                }}
              >
                {u === "both" ? "S&P + NQ" : u === "sp500" ? "S&P 500" : "NASDAQ"}
              </button>
            ))}
            {/* Signal scan */}
            {signalLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Zap size={10} style={{ color: "var(--blue)", animation: "pulse 1s ease-in-out infinite" }} />
                <span style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)" }}>
                  Scanning {signalProgress}%
                </span>
                <div style={{ width: "48px", height: "2px", background: "var(--bg-active)" }}>
                  <div style={{ width: `${signalProgress}%`, height: "100%", background: "var(--blue)", transition: "width 0.3s" }} />
                </div>
              </div>
            ) : Object.keys(signals).length < Math.min(quotes.length, 100) && (
              <button
                onClick={loadMoreSignals}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  fontFamily: SERIF, fontSize: "9px", fontWeight: 600,
                  padding: "3px 8px", cursor: "pointer",
                  background: "var(--blue-dim)", color: "var(--blue)",
                  border: "1px solid var(--blue)44",
                }}
              >
                <Zap size={9} /> Scan signals
              </button>
            )}
            <button onClick={() => load(universe)} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", display: "flex" }}>
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
          padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid var(--border)", padding: "2px 6px" }}>
            <Search size={10} style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Symbol…"
              style={{
                fontFamily: MONO, fontSize: "11px", width: "72px",
                background: "transparent", border: "none", outline: "none",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {([
              ["all",       `All (${quotes.length})`],
              ["gainers",   `▲ Gainers`],
              ["losers",    `▼ Losers`],
              ["vol_surge", `⚡ Vol Surge (${volSurge})`],
              ["long",      `▲ Long (${longSig})`],
              ["short",     `▼ Short (${shortSig})`],
              ["overbought",`RS≥85`],
              ["oversold",  `RS≤15`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontFamily: SERIF, fontSize: "9px", fontWeight: 600,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  padding: "3px 8px", cursor: "pointer",
                  background: filter === f
                    ? f === "gainers" || f === "long" || f === "overbought" ? "rgba(26,107,74,0.12)"
                    : f === "losers"  || f === "short" || f === "oversold"  ? "rgba(196,30,58,0.12)"
                    : f === "vol_surge" ? "rgba(180,83,9,0.12)"
                    : "var(--bg-active)"
                    : "transparent",
                  color: filter === f
                    ? f === "gainers" || f === "long" || f === "overbought" ? "#1A6B4A"
                    : f === "losers"  || f === "short" || f === "oversold"  ? "#C41E3A"
                    : f === "vol_surge" ? "#B45309"
                    : "var(--text-primary)"
                    : "var(--text-muted)",
                  border: `1px solid ${filter === f ? "currentColor" : "var(--border)"}44`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ marginLeft: "auto", fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)" }}>
            {filtered.length} results
          </span>
        </div>

        {/* Table */}
        {loading && quotes.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px", gap: "8px" }}>
            <RefreshCw size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            <div style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)" }}>
              Loading scanner data…
            </div>
            <div style={{ fontFamily: SERIF, fontSize: "10px", color: "var(--text-disabled)" }}>
              Background cache builds on first Render wake — takes ~3 min once
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "580px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <SortTh k="symbol"     label="Symbol"     align="left" />
                  <th style={{ width: "52px", textAlign: "left", padding: "7px 8px", fontFamily: SERIF, fontSize: "9px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)" }}>Univ</th>
                  <SortTh k="price"      label="Price" />
                  <SortTh k="change_pct" label="Chg%" />
                  <SortTh k="rs_rank"    label="RS" />
                  <SortTh k="vol_surge"  label="Vol×" />
                  <SortTh k="volume"     label="Volume" />
                  <SortTh k="market_cap" label="MktCap" />
                  <SortTh k="signal"     label="Signal" />
                  <th style={{ width: "64px", textAlign: "right", padding: "7px 12px 7px 8px", fontFamily: SERIF, fontSize: "9px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-raised)", borderBottom: "2px solid var(--border)" }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map(q => {
                  const up = q.change_pct >= 0;
                  const abs = Math.abs(q.change_pct);
                  const intensity = Math.min(abs / 5, 1);
                  const isNQ = q.universe === "nasdaq";
                  return (
                    <tr
                      key={q.symbol}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", height: "34px" }}
                      onClick={() => onSelectSymbol(q.symbol)}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Symbol */}
                      <td style={{ padding: "6px 10px 6px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ fontFamily: MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{q.symbol}</span>
                          {SECTOR[q.symbol] && (
                            <span style={{ fontFamily: SERIF, fontSize: "8px", color: "var(--text-disabled)" }}>{SECTOR[q.symbol]}</span>
                          )}
                        </div>
                      </td>
                      {/* Universe */}
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          fontFamily: SERIF, fontSize: "8px", fontWeight: 600,
                          letterSpacing: "0.1em", textTransform: "uppercase",
                          color: isNQ ? "#6366f1" : "var(--text-muted)",
                        }}>
                          {isNQ ? "NQ" : "SP"}
                        </span>
                      </td>
                      {/* Price */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <span style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-primary)" }}>
                          ${q.price.toFixed(2)}
                        </span>
                      </td>
                      {/* Change % with heatmap bar */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                          <div style={{
                            width: `${Math.max(3, Math.round(intensity * 40))}px`,
                            height: "10px",
                            background: up ? `rgba(26,107,74,${0.15 + intensity * 0.6})` : `rgba(196,30,58,${0.15 + intensity * 0.6})`,
                          }} />
                          <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 700, color: up ? "#1A6B4A" : "#C41E3A" }}>
                            {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                          </span>
                        </div>
                      </td>
                      {/* RS rank */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <RsBadge rank={q.rs_rank} />
                      </td>
                      {/* Vol surge */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        {q.vol_surge >= 1.5 ? (
                          <span style={{
                            fontFamily: MONO, fontSize: "10px", fontWeight: 600,
                            color: q.vol_surge >= 3 ? "#B45309" : "var(--text-secondary)",
                          }}>
                            {q.vol_surge.toFixed(1)}×
                          </span>
                        ) : (
                          <span style={{ fontFamily: MONO, fontSize: "10px", color: "var(--text-disabled)" }}>—</span>
                        )}
                      </td>
                      {/* Volume */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <span style={{ fontFamily: MONO, fontSize: "10px", color: "var(--text-secondary)" }}>
                          {fmtVol(q.volume)}
                        </span>
                      </td>
                      {/* Market cap */}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <span style={{ fontFamily: MONO, fontSize: "10px", color: "var(--text-secondary)" }}>
                          {fmtMktCap(q.market_cap)}
                        </span>
                      </td>
                      {/* ML signal */}
                      <td style={{ padding: "6px 10px" }} onClick={e => e.stopPropagation()}>
                        <SignalBadge item={signals[q.symbol]} />
                      </td>
                      {/* Analyse */}
                      <td style={{ padding: "6px 12px 6px 8px", textAlign: "right" }}>
                        <span style={{ fontFamily: SERIF, fontSize: "9px", fontWeight: 600, color: "var(--blue)", letterSpacing: "0.06em" }}>
                          Analyse →
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div style={{ padding: "8px 14px", fontFamily: SERIF, fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border)", background: "var(--bg-raised)" }}>
                Showing top 200 of {filtered.length} — use filters or search to narrow
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 12px", borderTop: "1px solid var(--border)", background: "var(--bg-raised)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-muted)" }}>
              <span style={{ color: "var(--green)", fontWeight: 700 }}>{gainers}</span> advancing ·{" "}
              <span style={{ color: "var(--red)", fontWeight: 700 }}>{losers}</span> declining ·{" "}
              <span style={{ color: "#B45309", fontWeight: 700 }}>{volSurge}</span> vol surges
            </span>
          </div>
          <span style={{ fontFamily: SERIF, fontSize: "9px", color: "var(--text-disabled)" }}>
            Data: yfinance · refreshes 2 min · click any row to analyse
          </span>
        </div>
      </div>
    </div>
  );
}
