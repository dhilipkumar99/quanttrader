"use client";

import { useEffect, useCallback, Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTrader } from "@/store/trader";
import { api, wakeRender, type CandlePoint, type ChartCandle, type ScanHorizon } from "@/lib/api";

// Panels
import { SignalPanel } from "@/components/panels/SignalPanel";
import { IndicatorsPanel } from "@/components/panels/IndicatorsPanel";
import { SimulatorPanel } from "@/components/panels/SimulatorPanel";
import { PortfolioPanel } from "@/components/panels/PortfolioPanel";
import { MarketOverviewPanel } from "@/components/panels/MarketOverviewPanel";
import { TradingPanel } from "@/components/panels/TradingPanel";
import { SP500Scanner } from "@/components/panels/SP500Scanner";
import { SignalExplainer } from "@/components/panels/SignalExplainer";
import { SignalHistoryPanel } from "@/components/panels/SignalHistoryPanel";
import { ComparisonPanel } from "@/components/panels/ComparisonPanel";
import { AgentPanel } from "@/components/panels/AgentPanel";
import { DayTradePicksPanel } from "@/components/panels/DayTradePicksPanel";
import { TradingCockpit } from "@/components/panels/TradingCockpit";
import { OptionsPanel } from "@/components/panels/OptionsPanel";

// UI
import { PriceTicker } from "@/components/ui/PriceTicker";
import { ToastContainer, toast } from "@/components/ui/Toast";
import { AnalysisSkeleton } from "@/components/ui/Skeleton";
import { TopBar } from "@/components/ui/TopBar";
import { Sidebar } from "@/components/ui/Sidebar";
import { StatusBar } from "@/components/ui/StatusBar";
import { PriceChart } from "@/components/charts/PriceChart";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";

export type Tab = "analysis" | "simulator" | "portfolio" | "market" | "trading" | "scanner" | "compare" | "agent" | "picks";

// Full-width TwelveData line chart used as fallback while candlestick data loads
function TdSparkFull({ candles }: { candles: ChartCandle[] }) {
  if (candles.length < 2) return null;
  const prices = candles.map(c => c.close);
  const min = Math.min(...prices) * 0.997;
  const max = Math.max(...prices) * 1.003;
  const range = max - min || 1;
  const W = 900; const H = 200; const pad = { t: 8, b: 24, l: 48, r: 8 };
  const iW = W - pad.l - pad.r;
  const iH = H - pad.t - pad.b;
  const toX = (i: number) => pad.l + (i / (prices.length - 1)) * iW;
  const toY = (p: number) => pad.t + (1 - (p - min) / range) * iH;
  const path = prices.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)} ${toY(p).toFixed(1)}`).join(" ");
  const areaPath = `${path} L${toX(prices.length - 1).toFixed(1)} ${(pad.t + iH).toFixed(1)} L${pad.l} ${(pad.t + iH).toFixed(1)} Z`;
  const isGreen = prices[prices.length - 1] >= prices[0];
  const color = isGreen ? "#1A6B4A" : "#C41E3A";
  // Y-axis ticks
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (max - min) * (i / yTicks));
  // X-axis labels (first, mid, last)
  const xLabels = [0, Math.floor(prices.length / 2), prices.length - 1];
  return (
    <div style={{ width: "100%", overflowX: "hidden" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "200px", display: "block" }}>
        <defs>
          <linearGradient id="td-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Y-axis grid + labels */}
        {tickVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
              <text x={pad.l - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#9B9280" fontFamily="monospace">
                ${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* X-axis labels */}
        {xLabels.map(i => (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9B9280" fontFamily="sans-serif">
            {candles[i]?.date?.slice(0, 10) ?? ""}
          </text>
        ))}
        <path d={areaPath} fill="url(#td-area)" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={toX(prices.length - 1)} cy={toY(prices[prices.length - 1])} r="3" fill={color} stroke="white" strokeWidth="1" />
      </svg>
    </div>
  );
}

function DataSourceBadge({ source }: { source: string }) {
  const isYF = source.toLowerCase().includes("yahoo");
  const isTD = source.toLowerCase().includes("twelvedata");
  const isCache = source.toLowerCase().includes("cache");
  const color = isCache
    ? { border: "#9B9280", text: "#6B5F52", bg: "rgba(155,146,128,0.08)" }
    : isTD
    ? { border: "#B45309", text: "#92400E", bg: "rgba(180,83,9,0.08)" }
    : isYF
    ? { border: "#1A6B4A", text: "#14532D", bg: "rgba(26,107,74,0.08)" }
    : { border: "#9B9280", text: "#6B5F52", bg: "rgba(155,146,128,0.08)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "2px 8px", borderRadius: "999px",
      border: `1px solid ${color.border}`,
      background: color.bg, color: color.text,
      fontSize: "11px", fontWeight: 500, letterSpacing: "0.01em",
    }}>
      <Database size={10} />
      {source}
    </span>
  );
}

function AppInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const {
    activeSymbol, activePeriod, activeTab,
    analysis, backtest,
    loading, backtestLoading, error,
    pinnedSymbols, portfolioCapital,
    setActiveSymbol, setActivePeriod, setActiveTab,
    setAnalysis, setBacktest, setWatchlist,
    setLoading, setBacktestLoading, setError,
  } = useTrader();

  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [tdCandles, setTdCandles] = useState<ChartCandle[] | null>(null);
  const [dataSourceBadge, setDataSourceBadge] = useState<string | null>(null);
  const [optionsHorizon, setOptionsHorizon] = useState<ScanHorizon>("day");
  const [serverReady, setServerReady] = useState(false);

  // Wake Render from free-tier sleep. Cold starts take up to 5 min.
  // Only set serverReady when we get a confirmed "ok" — never on timeout.
  useEffect(() => {
    wakeRender(300_000).then(ok => {
      if (ok) {
        setServerReady(true);
      } else {
        // 5-min timeout expired and Render never responded — unblock with warning
        setServerReady(true);
        toast("Server unreachable — data may be unavailable", "error");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sym = searchParams.get("symbol");
    if (sym && sym.toUpperCase() !== activeSymbol) {
      setActiveSymbol(sym.toUpperCase());
      setAnalysis(null);
    }
    const tab = searchParams.get("tab") as Tab | null;
    if (tab) setActiveTab(tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = analysis
      ? `${analysis.symbol} $${analysis.price.toFixed(2)} · QuantTrader Pro`
      : "QuantTrader Pro";
  }, [analysis]);

  const fetchAnalysis = useCallback(async (sym: string, period: string) => {
    setLoading(true); setError(null);
    try {
      const data = await api.analyze(sym, period);
      setAnalysis(data);
      // Show data-source notification
      const src = data.data_source ?? "Yahoo Finance";
      setDataSourceBadge(src);
      const isCached = src.toLowerCase().includes("cache");
      const isTD = src.toLowerCase().includes("twelvedata");
      toast(
        `${sym} ready · Data: ${src}`,
        isCached ? "info" : isTD ? "info" : "success"
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      const friendly = msg.includes("timeout") ? `${sym} timed out — try again` : `${sym}: ${msg}`;
      setError(friendly); toast(friendly, "error");
    } finally { setLoading(false); }
  }, [setLoading, setError, setAnalysis]);

  const fetchWatchlist = useCallback(async (syms: string[]) => {
    if (!syms.length) { setWatchlist([]); return; }
    try {
      const d = await api.watchlist(syms);
      setWatchlist(d.watchlist);
    } catch { /* non-critical */ }
  }, [setWatchlist]);

  const runBacktest = useCallback(async (cash: number, period: string) => {
    setBacktestLoading(true); setError(null);
    try {
      const data = await api.backtest(activeSymbol, period, cash);
      setBacktest(data); toast(`Backtest done for ${activeSymbol}`, "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown";
      setError(msg); toast(msg, "error");
    } finally { setBacktestLoading(false); }
  }, [activeSymbol, setBacktestLoading, setError, setBacktest]);

  useEffect(() => {
    if (!serverReady) return; // wait for Render to wake before firing real API calls
    fetchAnalysis(activeSymbol, activePeriod);
    // Fetch candles in parallel — TwelveData cache is instant if swept, yfinance is fallback
    setCandles([]);
    setTdCandles(null);
    api.candles(activeSymbol, activePeriod)
      .then(d => setCandles(d.candles))
      .catch(() => {});
    // Also try SQLite TwelveData cache — shows chart immediately if already swept
    const tdPeriod = activePeriod === "1w" || activePeriod === "5d" ? "1w"
                   : activePeriod === "3mo" || activePeriod === "1mo" ? "3mo" : "6mo";
    api.charts.forSymbol(activeSymbol, tdPeriod as "6mo" | "3mo" | "1w")
      .then(d => setTdCandles(d.candles))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, activePeriod, serverReady]);

  // Refresh quotes only for the user's pinned symbols
  useEffect(() => {
    fetchWatchlist(pinnedSymbols);
    if (!pinnedSymbols.length) return;
    const id = setInterval(() => fetchWatchlist(pinnedSymbols), 120_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedSymbols]);

  const handleSymbol = useCallback((sym: string) => {
    setActiveSymbol(sym); setAnalysis(null); setBacktest(null);
    router.replace(`/?symbol=${sym}`, { scroll: false });
  }, [setActiveSymbol, setAnalysis, setBacktest, router]);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/?symbol=${activeSymbol}&tab=${tab}`, { scroll: false });
  }, [activeSymbol, setActiveTab, router]);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <ToastContainer />

      {/* Server warm-up banner — shown on first load while Render wakes from free-tier sleep */}
      {!serverReady && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          padding: "6px 16px", fontSize: "12px", fontWeight: 500,
          background: "rgba(180,83,9,0.10)", borderBottom: "1px solid rgba(180,83,9,0.25)",
          color: "#92400E",
        }}>
          <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
          Warming up server (free tier cold start — first load may take 1–5 min)…
        </div>
      )}

      {/* Top bar */}
      <TopBar
        symbol={activeSymbol}
        onSymbolChange={handleSymbol}
        period={activePeriod}
        onPeriodChange={(p) => { setActivePeriod(p); setAnalysis(null); }}
        activeTab={activeTab as Tab}
        onTabChange={handleTabChange}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
      />

      {/* Body = sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          activeTab={activeTab as Tab}
          onTabChange={handleTabChange}
          onSelectSymbol={handleSymbol}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: "var(--bg-base)" }}>
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ background: "var(--red-dim)", borderBottom: "1px solid var(--red)", color: "var(--red)" }}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => fetchAnalysis(activeSymbol, activePeriod)} className="underline opacity-70 hover:opacity-100">retry</button>
              <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">✕</button>
            </div>
          )}

          <div className="p-3">
            {activeTab === "analysis" && (
              <>
                {loading ? <AnalysisSkeleton /> : analysis ? (
                  <div className="space-y-3">
                    <PriceTicker symbol={analysis.symbol} initialPrice={analysis.price} initialChangePct={analysis.change_pct} />
                    {/* Data source badge */}
                    {dataSourceBadge && <DataSourceBadge source={dataSourceBadge} />}
                    {/* Trading Cockpit — synthesized action plan for this stock */}
                    <TradingCockpit data={analysis} accountSize={portfolioCapital} />
                    {/* Price chart — TwelveData shows immediately from cache, candlestick follows */}
                    {(candles.length > 0 || tdCandles !== null) && (
                      <div className="panel p-3">
                        <div className="panel-header" style={{ margin: "-12px -12px 8px" }}>
                          <span>{analysis.symbol} — {activePeriod.toUpperCase()}</span>
                          <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                            {candles.length > 0 ? "▲ buy signal · ▼ sell signal" : "price chart · TwelveData"}
                          </span>
                        </div>
                        {candles.length > 0
                          ? <PriceChart data={candles} symbol={analysis.symbol} />
                          : tdCandles && <TdSparkFull candles={tdCandles} />
                        }
                      </div>
                    )}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <div className="xl:col-span-2 space-y-3">
                        <SignalPanel data={analysis} onCompare={() => handleTabChange("compare")} />
                        <SignalExplainer data={analysis} />
                        {/* Options horizon selector + panel */}
                        <div>
                          <div style={{ display: "flex", gap: "4px", marginBottom: "6px", flexWrap: "wrap" }}>
                            {(["day", "swing", "month", "quarter", "year"] as const).map(h => (
                              <button
                                key={h}
                                onClick={() => setOptionsHorizon(h)}
                                style={{
                                  fontFamily: "'Palatino Linotype', Palatino, serif",
                                  fontSize: "9px", fontWeight: 600,
                                  letterSpacing: "0.1em", textTransform: "uppercase",
                                  padding: "3px 10px", cursor: "pointer",
                                  background: optionsHorizon === h ? "var(--blue)" : "var(--bg-raised)",
                                  color: optionsHorizon === h ? "#FFFFFF" : "var(--text-muted)",
                                  border: `1px solid ${optionsHorizon === h ? "var(--blue)" : "var(--border)"}`,
                                  transition: "all 0.15s",
                                }}
                              >
                                {h}
                              </button>
                            ))}
                            <span style={{ fontFamily: "'Palatino Linotype', Palatino, serif", fontSize: "9px", color: "var(--text-muted)", alignSelf: "center", marginLeft: "4px" }}>
                              options horizon
                            </span>
                          </div>
                          <OptionsPanel symbol={analysis.symbol} horizon={optionsHorizon} />
                        </div>
                        <SignalHistoryPanel symbol={analysis.symbol} period={activePeriod} />
                      </div>
                      <div>
                        <IndicatorsPanel indicators={analysis.indicators} />
                      </div>
                    </div>
                  </div>
                ) : !error ? (
                  <EmptyState onSymbol={handleSymbol} />
                ) : null}
              </>
            )}
            {activeTab === "simulator" && (
              <SimulatorPanel result={backtest} loading={backtestLoading} onRun={runBacktest} symbol={activeSymbol} />
            )}
            {activeTab === "portfolio" && <PortfolioPanel />}
            {activeTab === "market" && (
              <MarketOverviewPanel
                onSelectSymbol={handleSymbol}
                onGoToAnalysis={(sym) => { handleSymbol(sym); handleTabChange("analysis"); }}
              />
            )}
            {activeTab === "trading" && (
              <TradingPanel defaultSymbol={activeSymbol} onSelectSymbol={handleSymbol} />
            )}
            {activeTab === "scanner" && (
              <SP500Scanner onSelectSymbol={(sym) => { handleSymbol(sym); handleTabChange("analysis"); }} />
            )}
            {activeTab === "compare" && (
              <ComparisonPanel
                initialSymbols={activeSymbol ? [activeSymbol] : []}
                period={activePeriod}
              />
            )}
            {activeTab === "agent" && <AgentPanel />}
            {activeTab === "picks" && (
              <DayTradePicksPanel
                onSelectSymbol={(sym) => { handleSymbol(sym); handleTabChange("analysis"); }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Status bar */}
      <StatusBar symbol={activeSymbol} analysis={analysis} />

      <KeyboardShortcuts
        handlers={{
          a: () => handleTabChange("analysis"),
          s: () => handleTabChange("simulator"),
          p: () => handleTabChange("portfolio"),
          m: () => handleTabChange("market"),
          t: () => handleTabChange("trading"),
          n: () => handleTabChange("scanner"),
          c: () => handleTabChange("compare"),
          g: () => handleTabChange("agent"),
          k: () => handleTabChange("picks"),
        }}
      />
    </div>
  );
}

function EmptyState({ onSymbol }: { onSymbol: (s: string) => void }) {
  const suggestions = ["AAPL", "NVDA", "MSFT", "TSLA", "META", "AMZN"];
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="text-3xl font-bold" style={{ color: "var(--text-secondary)" }}>QuantTrader Pro</div>
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>Enter a ticker or pick a popular stock</div>
      <div className="flex gap-2 flex-wrap justify-center mt-2">
        {suggestions.map(s => (
          <button key={s} onClick={() => onSymbol(s)} className="et-btn et-btn-ghost px-4 py-2">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyboardShortcuts({ handlers }: { handlers: Record<string, () => void> }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const fn = handlers[e.key.toLowerCase()];
      if (fn) fn();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handlers]);
  return null;
}

export default function Home() {
  return <Suspense fallback={null}><AppInner /></Suspense>;
}
