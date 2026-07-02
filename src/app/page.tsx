"use client";

import { useEffect, useCallback, Suspense, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTrader } from "@/store/trader";
import { api, wakeRender, ComputingError, type CandlePoint, type ChartCandle, type ScanHorizon } from "@/lib/api";

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
import { BeginnerModeView } from "@/components/panels/BeginnerModeView";
import { IntradayPanel } from "@/components/panels/IntradayPanel";
import { SimplifiedDashboard } from "@/components/panels/SimplifiedDashboard";
import { LeaderboardPanel } from "@/components/panels/LeaderboardPanel";

// UI
import { PriceTicker } from "@/components/ui/PriceTicker";
import { ToastContainer, toast } from "@/components/ui/Toast";
import { AnalysisSkeleton } from "@/components/ui/Skeleton";
import { TopBar } from "@/components/ui/TopBar";
import { Sidebar } from "@/components/ui/Sidebar";
import { StatusBar } from "@/components/ui/StatusBar";
import { PriceChart } from "@/components/charts/PriceChart";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";

export type Tab = "analysis" | "portfolio" | "market" | "trading" | "compare" | "picks" | "intraday";

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
    beginnerMode,
    setActiveSymbol, setActivePeriod, setActiveTab,
    setAnalysis, setBacktest, setWatchlist,
    setLoading, setBacktestLoading, setError,
    setBeginnerMode,
  } = useTrader();

  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [tdCandles, setTdCandles] = useState<ChartCandle[] | null>(null);
  const [dataSourceBadge, setDataSourceBadge] = useState<string | null>(null);
  const [optionsHorizon, setOptionsHorizon] = useState<ScanHorizon>("day");
  const [serverReady, setServerReady] = useState(false);

  // Track how long the tab has been hidden so we know if Render may have gone back to sleep
  const hiddenAtRef = useRef<number | null>(null);
  // Render free tier: sleeps after ~15 min idle. Use 13 min to be safe.
  const RENDER_IDLE_MS = 13 * 60 * 1000;

  const startWake = useCallback((refetch: boolean) => {
    setServerReady(false);
    wakeRender(300_000).then(ok => {
      setServerReady(true);
      if (!ok) {
        toast("Server unreachable — data may be unavailable", "error");
      } else if (refetch) {
        // Server was asleep and is now back — re-fetch so stale data gets refreshed.
        // setLoading(true) here ensures no EmptyState flash while the new fetch runs.
        setLoading(true);
        setAnalysis(null);
      }
    });
  }, [setLoading, setAnalysis]);

  // Initial wake on mount — no refetch needed (useEffect below fires once serverReady=true)
  useEffect(() => {
    startWake(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-wake when user returns to the tab after Render may have gone back to sleep
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else {
        const hiddenMs = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
        hiddenAtRef.current = null;
        if (hiddenMs >= RENDER_IDLE_MS) {
          // Pass refetch=true so data is refreshed after a long sleep.
          // serverReady flip false→true re-triggers the fetch useEffect below.
          startWake(true);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWake]);

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
      ? `${analysis.symbol} $${analysis.price.toFixed(2)} · QuantTrader`
      : "QuantTrader — AI Stock Signals";
  }, [analysis]);

  const fetchAnalysis = useCallback(async (sym: string, period: string, attempt = 0) => {
    setLoading(true); setError(null);
    try {
      const data = await api.analyze(sym, period);
      // Final backstop: if the server somehow returned zeros despite all server-side guards,
      // treat it as still-computing and retry rather than displaying broken output.
      if (data.composite_signal === 0 && data.composite_confidence === 0 && (!data.signals || data.signals.length === 0)) {
        if (attempt < 4) {
          // Do NOT call setLoading(false) — keep spinner visible between retries
          setTimeout(() => fetchAnalysis(sym, period, attempt + 1), 3000);
          return;
        }
      }
      setAnalysis(data);
      const src = data.data_source ?? "Yahoo Finance";
      setDataSourceBadge(src);
      const isCached = src.toLowerCase().includes("cache");
      const isTD = src.toLowerCase().includes("twelvedata");
      toast(
        `${sym} ready · Data: ${src}`,
        isCached ? "info" : isTD ? "info" : "success"
      );
      setLoading(false);
    } catch (e: unknown) {
      if (e instanceof ComputingError && attempt < 4) {
        // Server is computing in background — keep spinner visible, retry after hint delay
        const delay = (e.retryAfter ?? 3) * 1000;
        setTimeout(() => fetchAnalysis(sym, period, attempt + 1), delay);
        return;
      }
      const msg = e instanceof Error ? e.message : "Unknown error";
      const friendly = msg.includes("timeout") ? `${sym} timed out — try again` : `${sym}: ${msg}`;
      setError(friendly); toast(friendly, "error");
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Refresh quotes only for the user's pinned symbols — gated on serverReady
  // so we don't fire into a sleeping Render when the user returns after >15 min
  useEffect(() => {
    if (!serverReady) return;
    fetchWatchlist(pinnedSymbols);
    if (!pinnedSymbols.length) return;
    const id = setInterval(() => fetchWatchlist(pinnedSymbols), 120_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedSymbols, serverReady]);

  const handleSymbol = useCallback((sym: string) => {
    setActiveSymbol(sym); setAnalysis(null); setBacktest(null); setLoading(true);
    router.replace(`/?symbol=${sym}`, { scroll: false });
  }, [setActiveSymbol, setAnalysis, setBacktest, setLoading, router]);

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
          background: "rgba(26,107,74,0.08)", borderBottom: "1px solid rgba(26,107,74,0.2)",
          color: "#14532D",
        }}>
          <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
          Connecting to market data — this takes about 30 seconds on first load. Hang tight!
        </div>
      )}

      {/* Top bar */}
      <TopBar
        symbol={activeSymbol}
        onSymbolChange={handleSymbol}
        period={activePeriod}
        onPeriodChange={(p) => { setActivePeriod(p); setAnalysis(null); setLoading(true); }}
        activeTab={activeTab as Tab}
        onTabChange={handleTabChange}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        beginnerMode={beginnerMode}
        onToggleBeginnerMode={() => setBeginnerMode(!beginnerMode)}
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
                  beginnerMode ? (
                    <BeginnerModeView
                      data={analysis}
                      accountSize={portfolioCapital}
                      period={activePeriod}
                      onExpertMode={() => setBeginnerMode(false)}
                    />
                  ) : (
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
                              <span style={{ fontFamily: "'Palatino Linotype', Palatino, serif", fontSize: "10px", color: "var(--text-muted)", alignSelf: "center", marginLeft: "4px" }}>
                                — how far out to look
                              </span>
                            </div>
                            <OptionsPanel symbol={analysis.symbol} horizon={optionsHorizon} />
                          </div>
                          <SignalHistoryPanel symbol={analysis.symbol} period={activePeriod} />
                        </div>
                        <div>
                          <IndicatorsPanel
                            indicators={analysis.indicators}
                            oosSharp={analysis.oos_sharpe}
                            featureImportance={analysis.feature_importance}
                          />
                        </div>
                      </div>
                    </div>
                  )
                ) : !error ? (
                  <EmptyState onSymbol={handleSymbol} />
                ) : null}
              </>
            )}
            {activeTab === "portfolio" && (
              <PortfolioTabView
                backtest={backtest}
                backtestLoading={backtestLoading}
                onRunBacktest={runBacktest}
                activeSymbol={activeSymbol}
              />
            )}
            {activeTab === "market" && (
              <MarketTabView
                onSelectSymbol={handleSymbol}
                onGoToAnalysisTabOnly={() => handleTabChange("analysis")}
                serverReady={serverReady}
              />
            )}
            {activeTab === "trading" && (
              <TradingTabView defaultSymbol={activeSymbol} onSelectSymbol={handleSymbol} />
            )}
            {activeTab === "compare" && (
              <ComparisonPanel
                initialSymbols={activeSymbol ? [activeSymbol] : []}
                period={activePeriod}
              />
            )}
            {activeTab === "intraday" && <IntradayPanel />}
            {activeTab === "picks" && (
              beginnerMode
                ? <SimplifiedDashboard
                    onShowFullAnalysis={(sym) => { handleSymbol(sym); handleTabChange("analysis"); }}
                  />
                : <DayTradePicksPanel
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
          p: () => handleTabChange("portfolio"),
          m: () => handleTabChange("market"),
          t: () => handleTabChange("trading"),
          c: () => handleTabChange("compare"),
          k: () => handleTabChange("picks"),
          i: () => handleTabChange("intraday"),
        }}
      />
    </div>
  );
}

function EmptyState({ onSymbol }: { onSymbol: (s: string) => void }) {
  const suggestions = ["AAPL", "NVDA", "MSFT", "TSLA", "META", "AMZN"];
  const { onboarding } = useTrader();
  const router = useRouter();
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center justify-center pt-10 pb-4 gap-5 text-center" style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div>
          <div className="text-3xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "'Times New Roman', Times, Georgia, serif", marginBottom: "8px" }}>
            Find your next trade in seconds.
          </div>
          <div style={{ fontSize: "15px", color: "var(--text-secondary)", fontFamily: "'Palatino Linotype', Palatino, serif", lineHeight: 1.65 }}>
            QuantTrader scans the entire S&amp;P 500 and tells you exactly what to buy, how much to invest, and when to exit — in plain English. No finance degree required.
          </div>
        </div>

        {/* Feature pills */}
        <div className="flex gap-2 flex-wrap justify-center">
          {[
            "AI-powered buy/sell signals",
            "Exact position sizes",
            "Stop-loss & target prices",
            "500-scenario simulations",
          ].map(f => (
            <span key={f} style={{
              fontSize: "11px", padding: "4px 12px",
              background: "var(--green-dim)", color: "var(--green)",
              border: "1px solid rgba(26,107,74,0.25)",
              fontFamily: "'Palatino Linotype', Palatino, serif",
            }}>
              ✓ {f}
            </span>
          ))}
        </div>

        {!onboarding.completed && (
          <button
            onClick={() => router.push("/onboarding")}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              fontFamily: "'Palatino Linotype', Palatino, serif",
              fontSize: "14px", fontWeight: 700,
              padding: "12px 28px", marginTop: "4px",
              background: "var(--green)", color: "#fff",
              border: "none", cursor: "pointer",
            }}
          >
            Get started — it&apos;s free →
          </button>
        )}

        <div style={{ fontFamily: "'Palatino Linotype', Palatino, serif", fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
          Or try a stock right now:
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          {suggestions.map(s => (
            <button key={s} onClick={() => onSymbol(s)} className="et-btn et-btn-ghost px-4 py-2">
              {s}
            </button>
          ))}
        </div>
        {onboarding.completed && (
          <button
            onClick={() => router.push("/onboarding")}
            style={{
              fontFamily: "'Palatino Linotype', Palatino, serif",
              fontSize: "11px", color: "var(--text-disabled)",
              background: "none", border: "none", cursor: "pointer",
              textDecoration: "underline", marginTop: "4px",
            }}
          >
            Update my trading profile
          </button>
        )}
      </div>

      {/* Leaderboard as first-impression trust signal */}
      <div style={{ width: "100%", maxWidth: "900px" }}>
        <LeaderboardPanel onSelectSymbol={onSymbol} />
      </div>
    </div>
  );
}

// ── Consolidated tab views ─────────────────────────────────────────────────────

const SUB_TAB_STYLE = (active: boolean) => ({
  fontFamily: "'Palatino Linotype', Palatino, serif" as const,
  fontSize: "11px" as const, fontWeight: (active ? 700 : 400) as 700 | 400,
  letterSpacing: "0.1em" as const, textTransform: "uppercase" as const,
  padding: "4px 16px", cursor: "pointer" as const,
  background: active ? "var(--blue)" : "var(--bg-raised)",
  color: active ? "#fff" : "var(--text-muted)",
  border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
});

function SubTabBar({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
      {tabs.map(t => (
        <button key={t} style={SUB_TAB_STYLE(active === t)} onClick={() => onChange(t)}>{t}</button>
      ))}
    </div>
  );
}

function MarketTabView({ onSelectSymbol, onGoToAnalysisTabOnly, serverReady }: {
  onSelectSymbol: (s: string) => void;
  onGoToAnalysisTabOnly: () => void;
  serverReady: boolean;
}) {
  const [sub, setSub] = useState<"overview" | "scanner">("overview");
  return (
    <div>
      <SubTabBar tabs={["Market Overview", "Stock Scanner"]} active={sub === "overview" ? "Market Overview" : "Stock Scanner"} onChange={t => setSub(t === "Market Overview" ? "overview" : "scanner")} />
      {sub === "overview" && (
        // MarketOverviewPanel calls onSelectSymbol AND onGoToAnalysis separately in handleSelect.
        // onGoToAnalysis must only switch tab — onSelectSymbol already handles the symbol fetch.
        <MarketOverviewPanel onSelectSymbol={onSelectSymbol} onGoToAnalysis={(_sym) => onGoToAnalysisTabOnly()} serverReady={serverReady} />
      )}
      {sub === "scanner" && (
        // SP500Scanner has a single onSelectSymbol — we handle symbol + tab switch together.
        <SP500Scanner onSelectSymbol={(sym) => { onSelectSymbol(sym); onGoToAnalysisTabOnly(); }} serverReady={serverReady} />
      )}
    </div>
  );
}

function TradingTabView({ defaultSymbol, onSelectSymbol }: { defaultSymbol: string; onSelectSymbol: (s: string) => void }) {
  const [sub, setSub] = useState<"manual" | "agent">("manual");
  return (
    <div>
      <SubTabBar tabs={["Place a Trade", "AI Auto-Trade"]} active={sub === "manual" ? "Place a Trade" : "AI Auto-Trade"} onChange={t => setSub(t === "Place a Trade" ? "manual" : "agent")} />
      {sub === "manual" && <TradingPanel defaultSymbol={defaultSymbol} onSelectSymbol={onSelectSymbol} />}
      {sub === "agent"  && <AgentPanel />}
    </div>
  );
}

function PortfolioTabView({ backtest, backtestLoading, onRunBacktest, activeSymbol }: {
  backtest: import("@/types/quant").BacktestResult | null;
  backtestLoading: boolean;
  onRunBacktest: (cash: number, period: string) => Promise<void>;
  activeSymbol: string;
}) {
  const [sub, setSub] = useState<"portfolio" | "backtest">("portfolio");
  return (
    <div>
      <SubTabBar tabs={["My Portfolio", "Backtest Strategy"]} active={sub === "portfolio" ? "My Portfolio" : "Backtest Strategy"} onChange={t => setSub(t === "My Portfolio" ? "portfolio" : "backtest")} />
      {sub === "portfolio" && <PortfolioPanel />}
      {sub === "backtest"  && <SimulatorPanel result={backtest} loading={backtestLoading} onRun={onRunBacktest} symbol={activeSymbol} />}
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
