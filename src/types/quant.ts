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
