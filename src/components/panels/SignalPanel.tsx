"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { IndicatorGauge } from "@/components/charts/IndicatorGauge";
import { MonteCarloChart } from "@/components/charts/MonteCarloChart";
import { signalLabel, signalColor, signalBg, regimeColor, fmt, fmtPct, cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types/quant";
import { TrendingUp, TrendingDown, Minus, Shield } from "lucide-react";

interface Props {
  data: AnalysisResult;
}

const SOURCE_LABEL: Record<string, string> = {
  mean_reversion: "Mean Reversion",
  trend_follow:   "Trend Follow",
  momentum:       "Momentum",
  ml_gbm:         "ML Ensemble (GBM)",
};

const SOURCE_TIP: Record<string, string> = {
  mean_reversion: "Uses Bollinger Bands and RSI to detect when a stock has moved too far from its average and is likely to bounce back.",
  trend_follow:   "Uses three Exponential Moving Averages and MACD to detect whether the stock is in a sustained upward or downward trend.",
  momentum:       "The Jegadeesh-Titman strategy: stocks that performed well over the past 12 months (minus the last month) tend to keep outperforming.",
  ml_gbm:         "A Gradient Boosted Machine learning model trained on 14 features using walk-forward validation. Only signals when confidence exceeds 62%.",
};

const REGIME_TIP = "The current 'personality' of the stock's price movement — is it trending, bouncing in a range, or unusually volatile? The regime determines which signals get more weight.";
const CONFIDENCE_TIP = "How strongly the AI believes in this signal, combining all four sub-signals weighted by the current market regime. Higher is more decisive.";
const KELLY_TIP = "The Half-Kelly Criterion: the mathematically optimal percentage of your portfolio to allocate, divided by 2 for safety. Never exceeds 25%.";
const MC_TIP = "500 simulated 21-day futures, bootstrapped from real historical returns (not Gaussian). Shows the realistic spread of possible outcomes.";

export function SignalPanel({ data }: Props) {
  const sig = data.composite_signal;
  const conf = data.composite_confidence;
  const Icon = sig === 1 ? TrendingUp : sig === -1 ? TrendingDown : Minus;

  const signalShape = sig === 1 ? "▲" : sig === -1 ? "▼" : "■";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

      {/* ── Composite Signal ── */}
      <Card glow className={cn("lg:col-span-1 border", signalBg(sig))}>
        <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
          <div className={cn("p-4 rounded-full", signalBg(sig))}>
            <Icon className={cn("h-8 w-8", signalColor(sig))} strokeWidth={2.5} aria-hidden />
          </div>
          <div className="text-center">
            <div className={cn("text-4xl font-black tracking-tight", signalColor(sig))}>
              <span aria-hidden className="mr-2 text-2xl">{signalShape}</span>
              {signalLabel(sig)}
            </div>
            <div className="text-zinc-400 text-sm mt-1 flex items-center justify-center gap-1">
              <span>{data.symbol}</span>
              <span className="text-zinc-700">·</span>
              <span className={cn("capitalize", regimeColor(data.regime))}>
                {data.regime.replace(/_/g, " ")}
              </span>
              <InfoTooltip content={REGIME_TIP} />
            </div>
          </div>
          <div className="w-full px-4">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span className="flex items-center gap-1">
                Confidence
                <InfoTooltip content={CONFIDENCE_TIP} />
              </span>
              <span className="text-zinc-300 font-medium">{(conf * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-800" role="meter" aria-valuenow={Math.round(conf * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={cn("h-full rounded-full transition-all", sig === 1 ? "bg-emerald-500" : sig === -1 ? "bg-rose-500" : "bg-zinc-500")}
                style={{ width: `${Math.min(100, conf * 100)}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 w-full px-2">
            <StatMini
              label="Kelly Size"
              value={`${data.position_size_pct}%`}
              tooltip={KELLY_TIP}
            />
            <StatMini
              label="Exp Return"
              value={fmtPct(data.expected_return)}
              good={data.expected_return > 0}
              tooltip="Expected return over the analysis window, based on the ensemble model's output."
            />
          </div>
        </div>
      </Card>

      {/* ── Sub-signals ── */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Sub-Signals</CardTitle>
          <Badge variant={data.regime.includes("trend") ? "success" : "warning"}>
            {data.regime.replace("_", " ")}
          </Badge>
        </CardHeader>
        <div className="space-y-3">
          {data.signals.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Minus className="h-6 w-6 text-zinc-700 mx-auto" />
              <p className="text-zinc-500 text-sm">No active sub-signals</p>
              <p className="text-zinc-600 text-xs max-w-[200px] mx-auto leading-relaxed">
                All four signal generators returned neutral. The AI is waiting for clearer data before committing.
              </p>
            </div>
          ) : (
            data.signals.map((s, i) => (
              <div key={i} className={cn("flex items-center justify-between p-2.5 rounded-lg border", signalBg(s.direction))}>
                <div>
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
                    {SOURCE_LABEL[s.source] ?? s.source}
                    {SOURCE_TIP[s.source] && <InfoTooltip content={SOURCE_TIP[s.source]} />}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    Stop ${fmt(s.stop_loss)} · Target ${fmt(s.take_profit)}
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className={cn("text-sm font-bold flex items-center gap-0.5", signalColor(s.direction))}>
                    {s.direction === 1 ? "▲ " : s.direction === -1 ? "▼ " : "■ "}
                    {signalLabel(s.direction)}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {(s.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
              </div>
            ))
          )}
          {data.composite_signal === 0 && data.signals.length > 0 && (
            <p className="text-[11px] text-zinc-600 text-center pt-1 leading-relaxed">
              Signals are mixed — when the AI isn't confident, neutral is the safest outcome.
            </p>
          )}
        </div>
      </Card>

      {/* ── Risk & MC ── */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle>Risk & Monte Carlo</CardTitle>
            <InfoTooltip content={MC_TIP} />
          </div>
          <Shield className="h-4 w-4 text-zinc-500" aria-hidden />
        </CardHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <RiskStat label="Sharpe" value={fmt(data.risk_metrics.sharpe ?? 0)}
              tooltip="Risk-adjusted return. Above 1.0 is good, above 2.0 is excellent." />
            <RiskStat label="Sortino" value={fmt(data.risk_metrics.sortino ?? 0)}
              tooltip="Like Sharpe, but only penalises downside volatility." />
            <RiskStat label="Max DD" value={fmtPct(-(data.risk_metrics.max_drawdown ?? 0) * 100)} bad
              tooltip="Largest peak-to-trough drop in the analysis window." />
            <RiskStat label="Vol Ann" value={fmtPct(data.risk_metrics.volatility_ann ?? 0)} neutral
              tooltip="Annualised daily return volatility. Higher means more unpredictable." />
          </div>
          {data.monte_carlo && Object.keys(data.monte_carlo).length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">21-Day Monte Carlo</div>
              <MonteCarloChart mc={data.monte_carlo} />
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}

function StatMini({ label, value, good, tooltip }: { label: string; value: string; good?: boolean; tooltip?: string }) {
  return (
    <div className="bg-zinc-900/60 rounded-lg p-2 text-center">
      <div className="text-[10px] text-zinc-500 flex items-center justify-center gap-0.5">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={cn("text-sm font-bold", good === undefined ? "text-zinc-300" : good ? "text-emerald-400" : "text-rose-400")}>
        {value}
      </div>
    </div>
  );
}

function RiskStat({ label, value, bad, neutral, tooltip }: { label: string; value: string; bad?: boolean; neutral?: boolean; tooltip?: string }) {
  const color = neutral ? "text-zinc-300" : bad ? "text-rose-400" : "text-emerald-400";
  return (
    <div className="bg-zinc-800/40 rounded-lg p-2">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-0.5">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={cn("text-sm font-semibold", color)}>{value}</div>
    </div>
  );
}
