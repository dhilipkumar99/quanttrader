import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AnalysisResult, BacktestResult, WatchlistItem } from "@/types/quant";

export type AppTab = "analysis" | "simulator" | "portfolio" | "market" | "trading" | "scanner" | "compare" | "agent" | "picks";

// Persisted portfolio position — analysis is refetched on load, not stored (stale data)
export interface PortfolioEntry {
  symbol: string;
  capital: number;
}

interface TraderState {
  activeSymbol: string;
  activePeriod: string;
  activeTab: AppTab;
  analysis: AnalysisResult | null;
  backtest: BacktestResult | null;
  watchlist: WatchlistItem[];
  pinnedSymbols: string[];
  // Portfolio — symbols + capital persisted; analysis rehydrated on load
  portfolioEntries: PortfolioEntry[];
  portfolioCapital: number;
  loading: boolean;
  backtestLoading: boolean;
  error: string | null;
  paperCash: number;

  setActiveSymbol: (s: string) => void;
  setActivePeriod: (p: string) => void;
  setActiveTab: (t: AppTab) => void;
  setAnalysis: (a: AnalysisResult | null) => void;
  setBacktest: (b: BacktestResult | null) => void;
  setWatchlist: (w: WatchlistItem[]) => void;
  pinSymbol: (s: string) => void;
  unpinSymbol: (s: string) => void;
  setPortfolioEntries: (e: PortfolioEntry[]) => void;
  setPortfolioCapital: (n: number) => void;
  setLoading: (v: boolean) => void;
  setBacktestLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  setPaperCash: (n: number) => void;
}

export const useTrader = create<TraderState>()(
  persist(
    (set, get) => ({
      activeSymbol: "AAPL",
      activePeriod: "1y",
      activeTab:    "analysis",
      analysis:     null,
      backtest:     null,
      watchlist:    [],
      pinnedSymbols: [],
      portfolioEntries: [],
      portfolioCapital: 100_000,
      loading:      false,
      backtestLoading: false,
      error:        null,
      paperCash:    100_000,

      setActiveSymbol:  (s) => set({ activeSymbol: s }),
      setActivePeriod:  (p) => set({ activePeriod: p }),
      setActiveTab:     (t) => set({ activeTab: t }),
      setAnalysis:      (a) => set({ analysis: a }),
      setBacktest:      (b) => set({ backtest: b }),
      setWatchlist:     (w) => set({ watchlist: w }),
      pinSymbol: (s) => {
        const sym = s.toUpperCase();
        if (!get().pinnedSymbols.includes(sym))
          set({ pinnedSymbols: [...get().pinnedSymbols, sym] });
      },
      unpinSymbol: (s) => {
        set({ pinnedSymbols: get().pinnedSymbols.filter(p => p !== s.toUpperCase()) });
      },
      setPortfolioEntries: (e) => set({ portfolioEntries: e }),
      setPortfolioCapital: (n) => set({ portfolioCapital: n }),
      setLoading:          (v) => set({ loading: v }),
      setBacktestLoading:  (v) => set({ backtestLoading: v }),
      setError:            (e) => set({ error: e }),
      setPaperCash:        (n) => set({ paperCash: n }),
    }),
    {
      name: "quanttrader-store",
      partialize: (s) => ({
        pinnedSymbols:    s.pinnedSymbols,
        activeSymbol:     s.activeSymbol,
        activePeriod:     s.activePeriod,
        paperCash:        s.paperCash,
        portfolioEntries: s.portfolioEntries,
        portfolioCapital: s.portfolioCapital,
      }),
    }
  )
);
