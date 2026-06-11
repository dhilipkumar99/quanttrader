"use client";

import { useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTrader } from "@/store/trader";
import { api } from "@/lib/api";
import { SearchBar } from "@/components/panels/SearchBar";
import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { SignalPanel } from "@/components/panels/SignalPanel";
import { IndicatorsPanel } from "@/components/panels/IndicatorsPanel";
import { SimulatorPanel } from "@/components/panels/SimulatorPanel";
import { PortfolioPanel } from "@/components/panels/PortfolioPanel";
import { SignalExplainer } from "@/components/panels/SignalExplainer";
import { MobileNav } from "@/components/panels/MobileNav";
import { AnalysisSkeleton } from "@/components/ui/Skeleton";
import { PriceTicker } from "@/components/ui/PriceTicker";
import { ToastContainer, toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { BarChart2, FlaskConical, AlertTriangle, LayoutDashboard } from "lucide-react";
import Link from "next/link";

type Tab = "live" | "simulator" | "portfolio";

const TABS: { id: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: "live",      label: "Live Analysis",    Icon: BarChart2 },
  { id: "simulator", label: "Paper Simulator",  Icon: FlaskConical },
  { id: "portfolio", label: "Portfolio",         Icon: LayoutDashboard },
];

function AppInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const {
    activeSymbol, activePeriod, activeTab,
    analysis, backtest, watchlist,
    loading, backtestLoading, error,
    setActiveSymbol, setActivePeriod, setActiveTab,
    setAnalysis, setBacktest, setWatchlist,
    setLoading, setBacktestLoading, setError,
  } = useTrader();

  // Honour ?symbol= query param for shareable links
  useEffect(() => {
    const sym = searchParams.get("symbol");
    if (sym && sym.toUpperCase() !== activeSymbol) {
      setActiveSymbol(sym.toUpperCase());
      setAnalysis(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamic <title>
  useEffect(() => {
    document.title = analysis
      ? `${analysis.symbol} – $${analysis.price.toFixed(2)} · QuantTrader`
      : "QuantTrader – ML-Powered Systematic Trading";
  }, [analysis]);

  const fetchAnalysis = useCallback(async (sym: string, period: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.analyze(sym, period);
      setAnalysis(data);
      toast(`Analysis complete for ${sym}`, "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      const friendly = msg.includes("timeout")
        ? `${sym} analysis timed out. Yahoo Finance may be slow — try again in a moment.`
        : msg.includes("not found") || msg.includes("No data")
        ? `"${sym}" wasn't found. Double-check the ticker symbol and try again.`
        : `Could not analyse ${sym}. ${msg}`;
      setError(friendly);
      toast(friendly, "error");
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setAnalysis]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const data = await api.watchlist();
      setWatchlist(data.watchlist);
    } catch {
      // watchlist is non-critical
    }
  }, [setWatchlist]);

  const runBacktest = useCallback(async (cash: number, period: string) => {
    setBacktestLoading(true);
    setError(null);
    try {
      const data = await api.backtest(activeSymbol, period, cash);
      setBacktest(data);
      toast(`Backtest complete for ${activeSymbol}`, "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      const friendly = msg.includes("timeout")
        ? "Backtest timed out — try a shorter period like 6mo or 1y."
        : `Backtest failed for ${activeSymbol}. ${msg}`;
      setError(friendly);
      toast(friendly, "error");
    } finally {
      setBacktestLoading(false);
    }
  }, [activeSymbol, setBacktestLoading, setError, setBacktest]);

  useEffect(() => {
    fetchAnalysis(activeSymbol, activePeriod);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, activePeriod]);

  useEffect(() => {
    fetchWatchlist();
    const id = setInterval(fetchWatchlist, 120_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSymbol = (sym: string) => {
    setActiveSymbol(sym);
    setAnalysis(null);
    setBacktest(null);
    router.replace(`/?symbol=${sym}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <ToastContainer />

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <BarChart2 className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-100 leading-none">QuantTrader</div>
              <div className="text-[10px] text-zinc-500 leading-none mt-0.5">ML-Powered Systematic Trading</div>
            </div>
          </div>

          <SearchBar
            value={activeSymbol}
            onChange={handleSymbol}
            period={activePeriod}
            onPeriodChange={(p) => { setActivePeriod(p); setAnalysis(null); }}
          />

          <div className="hidden lg:flex items-center gap-3">
            <nav className="flex items-center gap-1 text-xs text-zinc-500">
              <Link href="/how-it-works" className="px-2 py-1 rounded hover:text-zinc-200 transition-colors">How it works</Link>
              <Link href="/glossary"     className="px-2 py-1 rounded hover:text-zinc-200 transition-colors">Glossary</Link>
              <Link href="/about"        className="px-2 py-1 rounded hover:text-zinc-200 transition-colors">About</Link>
            </nav>
            <div className="flex rounded-lg border border-zinc-700/40 overflow-hidden">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as any)}
                  aria-pressed={activeTab === id}
                  title={`${label} (Press ${id[0].toUpperCase()})`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all focus-visible:ring-1 focus-visible:ring-indigo-500",
                    activeTab === id
                      ? "bg-indigo-600/30 text-indigo-300"
                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <MobileNav
            watchlist={watchlist}
            activeTab={activeTab as any}
            setActiveTab={(t) => setActiveTab(t as any)}
            onSelect={handleSymbol}
          />
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-[1600px] mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="block mb-0.5 text-rose-200">Something went wrong</strong>
              {error}
            </div>
            <button
              onClick={() => fetchAnalysis(activeSymbol, activePeriod)}
              className="text-xs text-rose-400 underline hover:text-rose-200 flex-shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex gap-5">
          {/* Sidebar watchlist */}
          <aside className="w-56 flex-shrink-0 hidden lg:block">
            <WatchlistPanel items={watchlist} onSelect={handleSymbol} />
          </aside>

          <div className="flex-1 min-w-0 space-y-5">
            {/* ── Live Analysis Tab ── */}
            {activeTab === "live" && (
              <>
                {loading ? (
                  <AnalysisSkeleton />
                ) : analysis ? (
                  <>
                    <PriceTicker
                      symbol={analysis.symbol}
                      initialPrice={analysis.price}
                      initialChangePct={analysis.change_pct}
                    />

                    <SignalExplainer data={analysis} />
                    <SignalPanel data={analysis} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <IndicatorsPanel indicators={analysis.indicators} />

                      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
                        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                          Quant Rationale
                        </div>
                        <ul className="space-y-2 text-xs text-zinc-400">
                          <li className="flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">▸</span>
                            <span>
                              <strong className="text-zinc-200">Regime: </strong>
                              {analysis.regime === "trending_up"    && "Hurst > 0.6 + positive EMA spread → persistent uptrend. Trend-follow weight ×2."}
                              {analysis.regime === "trending_down"  && "Hurst > 0.6 + negative EMA spread → persistent downtrend. Trend-follow weight ×2."}
                              {analysis.regime === "mean_reverting" && "Hurst < 0.4 → prices revert to mean. Mean-reversion weight ×2.5."}
                              {analysis.regime === "volatile"       && "ATR 85th+ percentile → elevated volatility. All signal weights halved; ML ensemble primary."}
                              {analysis.regime === "quiet"          && "Moderate Hurst, normal volatility. Balanced signal weighting."}
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">▸</span>
                            <span>
                              <strong className="text-zinc-200">Sizing: </strong>
                              Half-Kelly criterion on empirical returns ({analysis.position_size_pct}% of portfolio).
                              {analysis.monte_carlo.cvar_5pct < -8 && " CVaR gate triggered — size halved due to tail risk."}
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">▸</span>
                            <span>
                              <strong className="text-zinc-200">ML: </strong>
                              GBM ensemble trained on walk-forward windows with 14 ADV-normalised features. Signals fire at &gt;62% probability.
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">▸</span>
                            <span>
                              <strong className="text-zinc-200">Risk: </strong>
                              {analysis.monte_carlo.prob_positive}% of 500 Monte Carlo paths (21-day) are profitable.
                              Worst-case DD: {analysis.monte_carlo.worst_dd}%.
                            </span>
                          </li>
                        </ul>
                        <div className="mt-4 pt-3 border-t border-zinc-800/40 flex items-center justify-between">
                          <span className="text-[10px] text-zinc-600">Share this analysis</span>
                          <a
                            href={`/analysis/${analysis.symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                          >
                            /analysis/{analysis.symbol} ↗
                          </a>
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-zinc-700 text-right">
                      Tip: press <kbd className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5">S</kbd> for Simulator ·{" "}
                      <kbd className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5">P</kbd> for Portfolio
                    </p>
                  </>
                ) : !error ? (
                  <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
                    <BarChart2 className="h-10 w-10 text-zinc-700" />
                    <div className="text-zinc-400 font-semibold">No data yet</div>
                    <div className="text-zinc-600 text-sm max-w-xs">
                      Enter a stock ticker above (e.g. AAPL, TSLA, NVDA) to run a full AI analysis.
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* ── Simulator Tab ── */}
            {activeTab === "simulator" && (
              <SimulatorPanel
                result={backtest}
                loading={backtestLoading}
                onRun={runBacktest}
                symbol={activeSymbol}
              />
            )}

            {/* ── Portfolio Tab ── */}
            {activeTab === "portfolio" && <PortfolioPanel />}
          </div>
        </div>
      </main>

      <KeyboardShortcuts
        onL={() => setActiveTab("live")}
        onS={() => setActiveTab("simulator")}
        onP={() => setActiveTab("portfolio" as any)}
      />
    </div>
  );
}

function KeyboardShortcuts({ onL, onS, onP }: { onL: () => void; onS: () => void; onP: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "l" || e.key === "L") onL();
      if (e.key === "s" || e.key === "S") onS();
      if (e.key === "p" || e.key === "P") onP();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onL, onS, onP]);
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <AppInner />
    </Suspense>
  );
}
