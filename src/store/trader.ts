import { create } from "zustand";
import type { AnalysisResult, BacktestResult, WatchlistItem } from "@/types/quant";

interface TraderState {
  activeSymbol: string;
  activePeriod: string;
  activeTab: "live" | "simulator" | "portfolio";
  analysis: AnalysisResult | null;
  backtest: BacktestResult | null;
  watchlist: WatchlistItem[];
  loading: boolean;
  backtestLoading: boolean;
  error: string | null;
  paperCash: number;

  setActiveSymbol: (s: string) => void;
  setActivePeriod: (p: string) => void;
  setActiveTab: (t: "live" | "simulator" | "portfolio") => void;
  setAnalysis: (a: AnalysisResult | null) => void;
  setBacktest: (b: BacktestResult | null) => void;
  setWatchlist: (w: WatchlistItem[]) => void;
  setLoading: (v: boolean) => void;
  setBacktestLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  setPaperCash: (n: number) => void;
}

export const useTrader = create<TraderState>((set) => ({
  activeSymbol: "AAPL",
  activePeriod: "1y",
  activeTab:    "live",
  analysis:     null,
  backtest:     null,
  watchlist:    [],
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
  setLoading:       (v) => set({ loading: v }),
  setBacktestLoading: (v) => set({ backtestLoading: v }),
  setError:         (e) => set({ error: e }),
  setPaperCash:     (n) => set({ paperCash: n }),
}));
