import type { AnalysisResult, BacktestResult, WatchlistItem } from "@/types/quant";

export interface SignalHistoryRecord {
  date: string;
  signal: 1 | -1 | 0;
  confidence: number;
  regime: string;
  price: number;
  fwd_return: number;
  outcome: "win" | "loss" | "neutral";
}

export interface SignalHistory {
  symbol: string;
  period: string;
  records: SignalHistoryRecord[];
  total: number;
  win_rate: number;
  wins: number;
  losses: number;
}

export interface AgentConfig {
  enabled: boolean;
  symbols: string[];
  poll_interval_min: number;
  min_confidence: number;
  min_signal: number;
  kelly_cap_pct: number;
  allow_short: boolean;
  dry_run: boolean;
  notify_email: string;
}

export interface AgentStatus {
  running: boolean;
  enabled: boolean;
  last_run_ts: string;
  last_run_summary: string;
  journal_count: number;
  error: string;
  dry_run: boolean;
}

export interface JournalEntry {
  ts: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  dollar_amount: number;
  signal: number;
  confidence: number;
  kelly_pct: number;
  regime: string;
  reason: string;
  order_id: string;
  dry_run: boolean;
}

export interface AgentRunResult {
  trades_executed: number;
  skipped: number;
  summary: string;
  entries: string[];
}

export interface AgentDigestRow {
  symbol: string;
  price: number;
  change_pct: number;
  signal: number;
  signal_word: string;
  confidence: number;
  regime: string;
  kelly_pct: number;
  actionable: boolean;
  error?: string;
}

export interface AgentDigest {
  generated_at: string;
  symbols_scanned: number;
  actionable_longs: number;
  actionable_shorts: number;
  results: AgentDigestRow[];
  headline: string;
}

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// AbortController-based fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Exponential backoff retry — only retries network errors and 5xx
async function fetchWithRetry(url: string, timeoutMs = 45_000, maxAttempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (res.ok || res.status < 500) return res; // 4xx = client error, don't retry
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
      if ((e as Error)?.name === "AbortError") {
        throw new Error("timeout");
      }
    }
  }
  throw lastErr;
}

async function fetchPost<T>(path: string, body: unknown, timeoutMs = 45_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(id);
  }
}

// Wake Render from free-tier sleep. Polls /api/wake until status=ok or timeout.
export async function wakeRender(timeoutMs = 55_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/wake`, { signal: AbortSignal.timeout(8_000) });
      const data = await res.json() as { status?: string };
      if (data.status === "ok") return true;
    } catch { /* still waking */ }
    await new Promise(r => setTimeout(r, 2_000));
  }
  return false;
}

async function get<T>(path: string, timeoutMs = 45_000): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, timeoutMs);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg === "no_data" ? "not found" : msg);
  }
  return res.json() as Promise<T>;
}

export interface PortfolioBacktestSymbol {
  symbol: string;
  total_return: number;
  sharpe: number;
  max_drawdown: number;
  n_trades: number;
  win_rate: number;
  final_value: number;
  alpha: number;
  allocation: number;
}

export interface PortfolioBacktestCurvePoint {
  t: string;
  total: number;
  pnl_pct: number;
  drawdown: number;
}

export interface PortfolioBacktestResult {
  symbols: string[];
  period: string;
  initial_cash: number;
  final_value: number;
  total_return: number;
  bnh_return: number;
  alpha: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  combined_curve: PortfolioBacktestCurvePoint[];
  per_symbol: PortfolioBacktestSymbol[];
}

export type ScanHorizon = "day" | "swing" | "month" | "quarter" | "year";
export type ScanUniverse = "sp500" | "nasdaq" | "both";

// ── Options types ─────────────────────────────────────────────────────────────

export interface OptionContract {
  symbol: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  open_interest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  dte: number;
  itm: boolean;
}

export interface OptionsChain {
  symbol: string;
  underlying_price: number;
  fetched_at: number;
  expiries: string[];
  calls: OptionContract[];
  puts: OptionContract[];
  iv_rank: number;
  iv_percentile: number;
  atm_iv: number;
  hist_vol_30d: number;
}

export interface OptionsSignalRec {
  signal_direction: 1 | -1;
  recommended_type: string;
  strategy: string;
  contract: OptionContract | null;
  spread_short_leg: OptionContract | null;
  max_profit: number;
  max_loss: number;
  breakeven: number;
  prob_profit: number;
  rationale: string;
  iv_environment: "cheap" | "fair" | "expensive";
  recommended_qty: number;
}

export interface OptionsSignalResult {
  symbol: string;
  signal: 1 | -1 | 0;
  signal_word: string;
  confidence: number;
  regime?: string;
  horizon: ScanHorizon;
  horizon_label?: string;
  underlying_price?: number;
  iv_rank?: number;
  atm_iv?: number;
  hist_vol?: number;
  recommendation: OptionsSignalRec | null;
  message?: string;
}

export interface DayTradePick {
  rank: number;
  symbol: string;
  direction: "long" | "short";
  price: number;
  change_pct: number;
  score: number;
  confidence: number;
  expected_return: number;
  position_size_pct: number;
  regime: string;
  horizon: ScanHorizon;
  rsi: number;
  sharpe: number;
  max_drawdown: number;
  mc_prob_positive: number;
  hurst: number;
  vol_adv_ratio: number;
  atr_pct: number;
  mom_12_1: number;
  mom_3: number;
  ret_5d: number;
  sub_signals: { source: string; direction: number; confidence: number }[];
}

export interface DayTradePicksResult {
  picks: DayTradePick[];
  total_picks: number;
  scanned_long: number;
  scanned_short: number;
  scanned_total: number;
  horizon: ScanHorizon;
  horizon_label: string;
  generated_at: string;
}

export interface CandlePoint {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  signal: 1 | -1 | 0;
}

export interface ChartCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartSweepStatus {
  swept: boolean;
  symbols_cached: number;
  started_at: number | null;
  finished_at: number | null;
  age_seconds: number | null;
  stale: boolean;
  source: string | null;
  trigger?: { status: string; symbols?: number; source?: string };
}

export const api = {
  candles: (symbol: string, period = "1y") =>
    get<{ symbol: string; period: string; candles: CandlePoint[] }>(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&period=${period}`, 60_000
    ),

  signalHistory: (symbol: string, period = "1y") =>
    get<SignalHistory>(
      `/api/signal-history?symbol=${encodeURIComponent(symbol)}&period=${period}`, 90_000
    ),

  analyze: (symbol: string, period = "1y") =>
    get<AnalysisResult>(`/api/analyze?symbol=${encodeURIComponent(symbol)}&period=${period}`, 45_000),

  backtest: (symbol: string, period = "1y", cash = 100_000) =>
    get<BacktestResult>(
      `/api/backtest?symbol=${encodeURIComponent(symbol)}&period=${period}&cash=${cash}`,
      55_000  // backtests are slow; give extra time
    ),

  watchlist: (symbols?: string[]) => {
    const q = symbols ? `?symbols=${symbols.map(encodeURIComponent).join(",")}` : "";
    return get<{ watchlist: WatchlistItem[] }>(`/api/watchlist${q}`, 55_000);
  },

  // ── Agent endpoints ────────────────────────────────────────────────────
  agent: {
    getConfig: () => get<AgentConfig>("/api/agent/config", 10_000),
    setConfig: (updates: Partial<AgentConfig>) =>
      fetchPost<AgentConfig>("/api/agent/config", updates),
    getStatus: () => get<AgentStatus>("/api/agent/status", 10_000),
    runOnce:   () => fetchPost<AgentRunResult>("/api/agent/run", {}),
    getJournal:(limit = 50) => get<{ journal: JournalEntry[]; total: number }>(`/api/agent/journal?limit=${limit}`, 10_000),
    getDigest:  () => get<AgentDigest>("/api/agent/digest", 120_000),
  },

  portfolioRisk: (symbols: string[], period = "1y") =>
    get<{
      symbols: string[]; period: string; avg_corr: number; max_pairwise_corr: number;
      diversification_score: number; pairs: Array<{ a: string; b: string; corr: number }>;
      corr_matrix: { symbols: string[]; values: number[][] };
      betas: Record<string, number>; warnings: string[];
    }>(
      `/api/portfolio/risk?symbols=${encodeURIComponent(symbols.join(","))}&period=${period}`,
      35_000
    ),

  portfolioBacktest: (symbols: string[], period = "1y", cash = 100_000) =>
    get<PortfolioBacktestResult>(
      `/api/portfolio/backtest?symbols=${encodeURIComponent(symbols.join(","))}&period=${period}&cash=${cash}`,
      120_000
    ),

  dayTradePicks: (limit = 20, horizon: ScanHorizon = "day", universe: ScanUniverse = "sp500", includeShorts = false) =>
    get<DayTradePicksResult>(`/api/daytrade-picks?limit=${limit}&horizon=${horizon}&universe=${universe}&include_shorts=${includeShorts}`, 120_000),

  charts: {
    sweep: (force = false) =>
      get<ChartSweepStatus>(`/api/charts/sweep?force=${force}`, 15_000),
    forSymbol: (symbol: string, period: "6mo" | "3mo" | "1w" = "6mo") =>
      get<{ symbol: string; period: string; candles: ChartCandle[] }>(
        `/api/chart-data/${encodeURIComponent(symbol)}?period=${period}`, 15_000
      ),
    batch: (symbols: string[], period: "6mo" | "3mo" | "1w" = "6mo") =>
      get<{ period: string; charts: Record<string, ChartCandle[]>; found: number; requested: number }>(
        `/api/charts/batch?symbols=${symbols.join(",")}&period=${period}`, 15_000
      ),
  },

  options: {
    chain: (symbol: string, force = false) =>
      get<OptionsChain>(`/api/options/chain?symbol=${encodeURIComponent(symbol)}&force=${force}`, 30_000),
    signal: (symbol: string, horizon: ScanHorizon = "day", portfolioValue = 10_000) =>
      get<OptionsSignalResult>(
        `/api/options/signal?symbol=${encodeURIComponent(symbol)}&horizon=${horizon}&portfolio_value=${portfolioValue}`,
        45_000
      ),
  },

  dataSourceStatus: () =>
    get<{
      cooldown_active: boolean;
      cooldown_remaining: number;
      calls_today: number;
      message: string;
      twelvedata: {
        last_call_at: number | null;
        calls_today: number;
        cooldown_remaining: number;
        cooldown_active: boolean;
      };
    }>("/api/data-source/status", 5_000),

  // Lightweight quote-only endpoint (for real-time ticker)
  quote: async (symbol: string): Promise<{ price: number; change_pct: number }> => {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`, 8_000
      );
      if (!res.ok) return { price: 0, change_pct: 0 };
      return res.json();
    } catch {
      return { price: 0, change_pct: 0 };
    }
  },
};
