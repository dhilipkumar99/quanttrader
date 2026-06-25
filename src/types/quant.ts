export type SignalDirection = 1 | -1 | 0;

export interface SubSignal {
  source: string;
  direction: SignalDirection;
  confidence: number;
  stop_loss: number;
  take_profit: number;
}

export interface RiskMetrics {
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  volatility_ann: number;
  win_rate: number;
}

export interface Indicators {
  rsi_14: number;
  macd_hist_norm: number;
  bb_pct: number;
  ema_8_21_spread: number;
  atr_pct: number;
  vol_adv_ratio: number;
  hurst: number;
  mom_12_1: number;
}

export interface MonteCarlo {
  p5: number;
  p50: number;
  p95: number;
  var_5pct: number;
  cvar_5pct: number;
  median_dd: number;
  worst_dd: number;
  prob_positive: number;
}

export interface AnalysisResult {
  symbol: string;
  price: number;
  change_pct: number;
  composite_signal: SignalDirection;
  composite_confidence: number;
  regime: string;
  position_size_pct: number;
  expected_return: number;
  risk_metrics: RiskMetrics;
  indicators: Indicators;
  monte_carlo: MonteCarlo;
  signals: SubSignal[];
  data_source?: string;
  beginner_summary?: string;
  oos_sharpe?: number;
  feature_importance?: [string, number][];
}

export interface WatchlistItem {
  symbol: string;
  price: number;
  change_pct: number;
  signal: SignalDirection;
  confidence: number;
  regime: string;
  rsi: number;
  sharpe: number;
  kelly_pct: number;
}

export interface BacktestFill {
  ts: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  slip: number;
  nv: number;
}

export interface BacktestSnapshot {
  t: string;
  total: number;
  pnl_pct: number;
  drawdown: number;
  bnh_pct: number;
}

export interface BacktestResult {
  symbol: string;
  initial_cash: number;
  final_value: number;
  total_return: number;
  bnh_return: number;
  alpha: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  avg_slippage_bps: number;
  n_trades: number;
  equity_curve: number[];
  snapshots: BacktestSnapshot[];
  fills: BacktestFill[];
}

// ── Market Data ──────────────────────────────────────────────────────────────
export interface BookLevel {
  price: number;
  size: number;
  side: "buy" | "sell";
}

export interface OrderBook {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number;
  mid_price: number;
  best_bid: number | null;
  best_ask: number | null;
  synthetic: boolean;
}

export interface MarketMover {
  symbol: string;
  price: number;
  change_pct: number;
  volume: number;
}

export interface SectorData {
  name: string;
  etf: string;
  price: number;
  change_pct: number;
}

export interface IndexData {
  name: string;
  symbol: string;
  price: number;
  change_pct: number;
}

export interface OHLCBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
}

// ── Broker ───────────────────────────────────────────────────────────────────
export interface BrokerAccount {
  connected: boolean;
  id?: string;
  status?: string;
  cash?: number;
  portfolio_value?: number;
  buying_power?: number;
  equity?: number;
  last_equity?: number;
  day_trade_count?: number;
  paper?: boolean;
  trading_blocked?: boolean;
  pattern_day_trader?: boolean;
  message?: string;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  side: string;
}

export interface BrokerOrder {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  order_type: string;
  status: string;
  filled_qty: number;
  filled_avg_price: number | null;
  limit_price: number | null;
  created_at: string;
}

// ── S&P 500 ──────────────────────────────────────────────────────────────────
export interface SP500Quote {
  symbol: string;
  price: number;
  change_pct: number;
  volume: number;
  market_cap: number;
}

export interface HeatTile {
  symbol: string;
  change_pct: number;
  market_cap: number;
  price: number;
}
