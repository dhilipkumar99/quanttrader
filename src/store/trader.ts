import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AnalysisResult, BacktestResult, WatchlistItem } from "@/types/quant";

export type AppTab = "analysis" | "simulator" | "portfolio" | "market" | "trading" | "scanner" | "compare" | "agent" | "picks" | "intraday";

export interface PortfolioEntry {
  symbol: string;
  capital: number;
}

export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type TradingExperience = "beginner" | "intermediate" | "advanced";
export type TradingGoal = "income" | "growth" | "preservation";

export interface OnboardingProfile {
  completed: boolean;
  accountSize: number;
  riskTolerance: RiskTolerance;
  experience: TradingExperience;
  goal: TradingGoal;
  email: string;
  brokerConnected: boolean;
  tutorialSeen: boolean;
}

// Derives sensible agent config defaults from the onboarding profile.
// Called by the onboarding page after saving and by BeginnerModeView.
export function profileToAgentDefaults(p: OnboardingProfile): {
  kellyCapPct: number;
  minConfidence: number;
  beginnerMode: boolean;
  horizon: "day" | "swing" | "month" | "quarter" | "year";
} {
  const kellyMap: Record<RiskTolerance, number> = {
    conservative: 5,
    moderate:     12,
    aggressive:   20,
  };
  const confMap: Record<RiskTolerance, number> = {
    conservative: 0.80,
    moderate:     0.70,
    aggressive:   0.60,
  };
  // goal → analysis horizon: income = short-term swing trades, growth = monthly,
  // preservation = quarterly (fewer, higher-conviction signals only)
  const horizonMap: Record<TradingGoal, "day" | "swing" | "month" | "quarter" | "year"> = {
    income:       "swing",
    growth:       "month",
    preservation: "quarter",
  };
  return {
    kellyCapPct:    kellyMap[p.riskTolerance],
    minConfidence:  confMap[p.riskTolerance],
    beginnerMode:   p.experience === "beginner",
    horizon:        horizonMap[p.goal],
  };
}

interface TraderState {
  activeSymbol: string;
  activePeriod: string;
  activeTab: AppTab;
  analysis: AnalysisResult | null;
  backtest: BacktestResult | null;
  watchlist: WatchlistItem[];
  pinnedSymbols: string[];
  portfolioEntries: PortfolioEntry[];
  portfolioCapital: number;
  loading: boolean;
  backtestLoading: boolean;
  error: string | null;
  paperCash: number;
  beginnerMode: boolean;
  onboarding: OnboardingProfile;

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
  setBeginnerMode: (v: boolean) => void;
  setOnboarding: (p: OnboardingProfile) => void;
  setBrokerConnected: (v: boolean) => void;
  setTutorialSeen: (v: boolean) => void;
}

const DEFAULT_ONBOARDING: OnboardingProfile = {
  completed:       false,
  accountSize:     10_000,
  riskTolerance:   "moderate",
  experience:      "beginner",
  goal:            "growth",
  email:           "",
  brokerConnected: false,
  tutorialSeen:    false,
};

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
      beginnerMode: false,
      onboarding:   DEFAULT_ONBOARDING,

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
      setBeginnerMode:     (v) => set({ beginnerMode: v }),
      setOnboarding:       (p) => set({ onboarding: p }),
      setBrokerConnected:  (v) => set({ onboarding: { ...get().onboarding, brokerConnected: v } }),
      setTutorialSeen:     (v) => set({ onboarding: { ...get().onboarding, tutorialSeen: v } }),
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
        beginnerMode:     s.beginnerMode,
        onboarding:       s.onboarding,
      }),
    }
  )
);
