"use client";

import { MonteCarloChart } from "@/components/charts/MonteCarloChart";
import { MetricExplainer } from "@/components/ui/Tooltip";
import { signalLabel, regimeColor, fmt, fmtPct } from "@/lib/utils";
import type { AnalysisResult } from "@/types/quant";
import { TrendingUp, TrendingDown, Minus, Shield, GitCompare } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type Status = "green" | "yellow" | "red" | "blue" | "neutral";

const SOURCE_LABEL: Record<string, string> = {
  MeanReversion: "Mean Reversion",
  TrendFollow:   "Trend Follow",
  Momentum:      "Momentum",
  MLSignal:      "ML Ensemble (GBM)",
  mean_reversion: "Mean Reversion",
  trend_follow:   "Trend Follow",
  momentum:       "Momentum",
  ml_gbm:         "ML Ensemble (GBM)",
};

const SOURCE_WHAT: Record<string, string> = {
  MeanReversion:  "Uses Bollinger Bands + RSI to detect when a stock has moved too far from its average and is likely to snap back — like a stretched rubber band.",
  TrendFollow:    "Uses 3 moving averages + MACD to detect when a stock is in a sustained uptrend or downtrend. Goes with the flow.",
  Momentum:       "The 'winners keep winning' effect. Stocks that outperformed over the past 12 months (minus the last month) tend to keep outperforming. Based on decades of academic research.",
  MLSignal:       "A machine learning model (Gradient Boosting) trained on 14 market features using walk-forward testing. It only fires when it has at least 62% certainty.",
  mean_reversion: "Uses Bollinger Bands + RSI to detect when a stock has moved too far from its average and is likely to snap back.",
  trend_follow:   "Uses 3 moving averages + MACD to detect when a stock is in a sustained uptrend or downtrend.",
  momentum:       "Stocks that outperformed over the past 12 months tend to keep outperforming.",
  ml_gbm:         "Machine learning model (GBM) trained on 14 market features. Fires at >62% confidence.",
};

function sharpeConfig(s: number, sym: string): { status: Status; now: string; action: string } {
  if (s >= 2)    return { status: "green",   now: `Sharpe of ${s.toFixed(2)} is excellent. ${sym} has been delivering strong returns relative to its risk historically.`, action: "Green light. This stock has historically rewarded traders well. The model is in high-confidence territory." };
  if (s >= 1)    return { status: "green",   now: `Sharpe of ${s.toFixed(2)} is good. ${sym} has been earning more than 1× its risk level.`, action: "Good risk-adjusted return history. This is a tradeable setup." };
  if (s >= 0.5)  return { status: "blue",    now: `Sharpe of ${s.toFixed(2)} is moderate. Returns have outpaced risk but not by a wide margin.`, action: "Acceptable. Make sure the signal and confidence are strong before entering." };
  if (s >= 0)    return { status: "yellow",  now: `Sharpe of ${s.toFixed(2)} is weak. This strategy has barely made more than it risked historically.`, action: "Reduce position size. The reward relative to risk is thin." };
  return           { status: "red",     now: `Sharpe of ${s.toFixed(2)} is negative — the strategy has historically lost money on a risk-adjusted basis.`, action: "⚠ Red flag. Even if the signal says LONG, be very cautious. Consider skipping or trading tiny size." };
}

function maxDdConfig(dd: number, sym: string): { status: Status; now: string; action: string } {
  // dd is a positive % already
  if (dd < 10)   return { status: "green",   now: `Max drawdown of −${dd.toFixed(1)}% is low. The worst historical drop from a peak was only ${dd.toFixed(1)}%.`, action: "Tight drawdowns mean you never had to endure large losses. Use a stop loss of around −${(dd * 0.5).toFixed(0)}% to protect capital." };
  if (dd < 20)   return { status: "blue",    now: `Max drawdown of −${dd.toFixed(1)}%. In the worst historical period, ${sym} dropped ${dd.toFixed(1)}% from its peak before recovering.`, action: `Set your stop loss at about −${(dd * 0.4).toFixed(0)}–${(dd * 0.6).toFixed(0)}% below your entry. Never ride the full drawdown.` };
  if (dd < 35)   return { status: "yellow",  now: `Max drawdown of −${dd.toFixed(1)}% is high. This stock has historically fallen sharply at some points.`, action: `Be careful. Never hold through a full drawdown. Cut your loss at −${(dd * 0.35).toFixed(0)}% maximum.` };
  return           { status: "red",     now: `Max drawdown of −${dd.toFixed(1)}% is severe. This stock has crashed hard in the past.`, action: "Size very small. Set a tight stop loss immediately on entry. High-risk setup — only for experienced traders." };
}

function kellyConfig(k: number, sym: string): { status: Status; now: string; action: string } {
  if (k === 0)   return { status: "red",     now: `Kelly % is 0% — the math says do NOT trade ${sym} right now.`, action: "Skip this trade entirely. When Kelly = 0%, putting money in is statistically expected to lose. Trust the math." };
  if (k >= 15)   return { status: "green",   now: `Kelly % is ${k.toFixed(1)}% — the model is very confident in this trade. If your account is $10,000, this means investing about $${(10000 * k / 100).toFixed(0)}.`, action: `Strong signal. You can invest up to ${k.toFixed(1)}% of your account here. For $10k that's $${(10000 * k / 100).toFixed(0)}.` };
  if (k >= 7)    return { status: "green",   now: `Kelly % is ${k.toFixed(1)}%. Solid conviction. For a $10,000 account that's about $${(10000 * k / 100).toFixed(0)} in this trade.`, action: `Good setup. Invest ${k.toFixed(1)}% of your account. Never invest more than Kelly suggests.` };
  if (k >= 3)    return { status: "blue",    now: `Kelly % is ${k.toFixed(1)}% — moderate conviction. The system sees edge but it's not overwhelming.`, action: `Invest only ${k.toFixed(1)}% of your account. This is a smaller trade — that's appropriate given the moderate conviction.` };
  return           { status: "yellow",  now: `Kelly % is ${k.toFixed(1)}% — very small suggested size. The edge exists but is thin.`, action: "Trade minimum size or skip. Very small Kelly values often mean mixed signals. Only trade this if everything else aligns." };
}

function expRetConfig(er: number, sym: string): { status: Status; now: string; action: string } {
  const pct = (er * 100).toFixed(1);
  if (er > 0.3)  return { status: "green",   now: `Expected return is +${pct}% — the model projects strong upside for ${sym} over the holding period.`, action: "Strong positive edge. This is why the signal fired. Remember this is a projection, not a guarantee — always use a stop loss." };
  if (er > 0.1)  return { status: "green",   now: `Expected return is +${pct}% — the model sees a positive edge for ${sym}.`, action: "Positive expected value. Good setup for a long trade. Use proper position sizing." };
  if (er > 0)    return { status: "blue",    now: `Expected return is +${pct}% — slightly positive but not dramatic.`, action: "Thin edge. Make sure Confidence and Kelly are both strong before committing capital." };
  if (er > -0.1) return { status: "yellow",  now: `Expected return is ${pct}% — near zero or slightly negative. The model sees limited edge here.`, action: "Weak trade. Consider waiting for a clearer signal or skipping today." };
  return           { status: "red",     now: `Expected return is ${pct}% — negative. The model projects a loss on this trade.`, action: "⚠ Do not enter a long position. This is a red-flag setup. Wait for the expected return to turn positive." };
}

function mcConfig(prob: number, sym: string): { status: Status; now: string; action: string } {
  if (prob >= 70) return { status: "green",   now: `Monte Carlo shows ${prob}% of 500 simulated futures end profitably for ${sym}. The odds strongly favor a win.`, action: "High probability setup. The simulation is strongly in your favour. Proceed with confidence — but still use a stop loss." };
  if (prob >= 60) return { status: "green",   now: `Monte Carlo shows ${prob}% probability of profit. More than 3 out of 5 simulated paths end in gains.`, action: "Good odds. Trade it with appropriate size." };
  if (prob >= 50) return { status: "blue",    now: `Monte Carlo shows ${prob}% — slightly better than a coin flip. The edge is real but slim.`, action: "Marginally positive odds. Only trade if Kelly, Confidence, and Signal all agree." };
  if (prob >= 40) return { status: "yellow",  now: `Monte Carlo shows only ${prob}% — less than half the simulated paths end profitably.`, action: "Odds are against you. This is a risky trade. If you enter, use very small size and a tight stop." };
  return           { status: "red",     now: `Monte Carlo shows ${prob}% — significantly less than 50/50. Most simulated futures for ${sym} end in a loss.`, action: "⚠ Poor odds. This trade is statistically unfavourable. Skip it and wait for better conditions." };
}

function regimeConfig(regime: string): { status: Status; now: string; action: string } {
  const r = regime.toLowerCase();
  if (r.includes("trending_up"))   return { status: "green",  now: "The stock is in a clear UPTREND. Momentum-based and trend-following strategies work best.", action: "Ride the trend. Set a trailing stop 1–2× ATR below the current price so you lock in gains as the stock rises." };
  if (r.includes("trending_down")) return { status: "red",    now: "The stock is in a DOWNTREND. Going long (buying) is fighting the trend — extra caution needed.", action: "If the LONG signal is very strong (Kelly > 10%, Confidence > 80%), you can enter — but size small and use a tight stop. The wind is in your face." };
  if (r.includes("volatile"))      return { status: "yellow", now: "The stock is in a HIGH-VOLATILITY regime. Big swings in both directions are happening.", action: "Size down by 30–50% vs normal. Volatile regimes mean fast moves — your stop loss might get hit even if you're eventually right." };
  if (r.includes("mean_rev"))      return { status: "blue",   now: "The stock is in a MEAN-REVERTING regime. It bounces between highs and lows rather than trending.", action: "Look for extreme RSI readings (< 30 to buy, > 70 to sell). Exit quickly at the middle of the range." };
  return { status: "neutral", now: "Quiet, low-volatility regime. Small moves, less opportunity.", action: "Day trading potential is limited today. This stock might be better suited for a swing trade (multi-day hold)." };
}

function signalConfig(sig: number, conf: number, sym: string): { status: Status; what: string; now: string; action: string } {
  const confPct = (conf * 100).toFixed(0);
  const what = "The Signal is the bottom line — buy (LONG), sell short (SHORT), or stay out (FLAT). It's produced by combining 4 different sub-models (trend, mean-reversion, momentum, ML). When they all agree, confidence is high. When they disagree, it's FLAT.";
  if (sig === 1) {
    const action = conf >= 0.8
      ? `HIGH CONVICTION LONG. The system is ${confPct}% confident. Enter a long position sized at the Kelly % shown. Set your stop loss before you buy.`
      : conf >= 0.6
      ? `Moderate LONG signal at ${confPct}% confidence. Trade it with normal Kelly sizing, but don't over-allocate.`
      : `Weak LONG signal at only ${confPct}% confidence. Small size only — the sub-models don't fully agree.`;
    return { status: "green", what, now: `${sym} is showing a LONG signal with ${confPct}% confidence. The model says: buy and hold for the trading session.`, action };
  }
  if (sig === -1) {
    const action = conf >= 0.8
      ? `HIGH CONVICTION SHORT. The system is ${confPct}% confident this stock will fall. If you can short, do so at Kelly sizing. If not, EXIT any long position immediately.`
      : `SHORT signal at ${confPct}% confidence. If you hold a long position in ${sym}, SELL IT NOW. For new shorts, use small size.`;
    return { status: "red", what, now: `${sym} is showing a SHORT signal with ${confPct}% confidence. The model sees downside ahead.`, action };
  }
  return { status: "neutral", what, now: `${sym} has no clear edge right now. The sub-models are disagreeing — some say up, some say down.`, action: "Stay out. Do not enter a new trade when the signal is FLAT. Wait for a clearer direction — usually within 1–4 trading sessions." };
}

export function SignalPanel({ data, onCompare }: { data: AnalysisResult; onCompare?: () => void }) {
  const sig  = data.composite_signal;
  const conf = data.composite_confidence;
  const sym  = data.symbol;
  const Icon = sig === 1 ? TrendingUp : sig === -1 ? TrendingDown : Minus;
  const sigColor = sig === 1 ? "var(--green)" : sig === -1 ? "var(--red)" : "var(--yellow)";
  const sigBg    = sig === 1 ? "var(--green-dim)" : sig === -1 ? "var(--red-dim)" : "var(--yellow-dim)";

  const sigCfg    = signalConfig(sig, conf, sym);
  const sharpeCfg = sharpeConfig(data.risk_metrics?.sharpe ?? 0, sym);
  const ddCfg     = maxDdConfig((data.risk_metrics?.max_drawdown ?? 0) * 100, sym);
  const kellyCfg  = kellyConfig(data.position_size_pct ?? 0, sym);
  const erCfg     = expRetConfig(data.expected_return ?? 0, sym);
  const mcCfg     = mcConfig(data.monte_carlo?.prob_positive ?? 0, sym);
  const regCfg    = regimeConfig(data.regime ?? "quiet");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", overflow: "visible" }}
         className="xl:grid-cols-3 grid-cols-1">

      {/* ── Composite Signal ── */}
      <div className="panel p-4 flex flex-col items-center justify-center gap-3"
        style={{ borderColor: sigColor, boxShadow: `0 0 20px ${sigBg}`, overflow: "visible" }}>

        <MetricExplainer
          label="Signal" value={signalLabel(sig)}
          what={sigCfg.what} now={sigCfg.now} action={sigCfg.action} status={sigCfg.status}
          wide
        >
          <div className="flex flex-col items-center gap-3 cursor-help w-full">
            <div className="p-3" style={{ background: sigBg }}>
              <Icon className="h-8 w-8" style={{ color: sigColor }} strokeWidth={2.5} />
            </div>
            <div className="text-center">
              <div className="text-3xl font-black tracking-tight" style={{ color: sigColor }}>
                {signalLabel(sig)}
              </div>
              <div className="text-xs mt-1 flex items-center justify-center gap-1.5"
                style={{ color: "var(--text-secondary)" }}>
                <span>{sym}</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <MetricExplainer
                  label="Market Regime" value={(data.regime ?? "").replace(/_/g, " ")}
                  what="The regime is the overall 'weather' for this stock right now — is it trending up, trending down, bouncing around (volatile), or quietly doing nothing?"
                  now={regCfg.now} action={regCfg.action} status={regCfg.status}
                >
                  <span style={{ color: regimeColor(data.regime), cursor: "help",
                    borderBottom: "1px dashed", borderColor: regimeColor(data.regime) }}>
                    {(data.regime ?? "").replace(/_/g, " ")}
                  </span>
                </MetricExplainer>
              </div>
            </div>
          </div>
        </MetricExplainer>

        {/* Confidence bar */}
        <MetricExplainer
          label="Confidence" value={`${(conf * 100).toFixed(1)}%`}
          what="Confidence measures how much all 4 sub-models agree with each other. 100% means all 4 say the same thing. 50% means they're split. Think of it like asking 4 experts — high confidence = all 4 say the same thing."
          now={conf >= 0.8 ? `${(conf * 100).toFixed(0)}% confidence — all sub-models strongly agree. This is a high-conviction setup.` : conf >= 0.6 ? `${(conf * 100).toFixed(0)}% confidence — most sub-models agree but there's some disagreement.` : `${(conf * 100).toFixed(0)}% confidence — models are not in strong agreement. Lower conviction trade.`}
          action={conf >= 0.8 ? "High conviction — full Kelly sizing is justified." : conf >= 0.6 ? "Moderate conviction — trade at 50–75% of Kelly suggested size." : "Low conviction — trade very small or skip. Wait for higher confidence."}
          status={conf >= 0.8 ? "green" : conf >= 0.6 ? "blue" : "yellow"}
        >
          <div className="w-full px-2 cursor-help">
            <div className="flex justify-between text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>
              <span style={{ fontFamily: FONT_BODY, borderBottom: "1px dashed rgba(255,255,255,0.2)" }}>
                Confidence
              </span>
              <span className="num font-semibold" style={{ color: sigColor }}>{(conf * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full" style={{ background: "var(--bg-active)" }}>
              <div className="h-full transition-all" style={{ width: `${conf * 100}%`, background: sigColor }} />
            </div>
          </div>
        </MetricExplainer>

        {/* Kelly + Expected return */}
        <div className="grid grid-cols-2 gap-2 w-full">
          <MetricExplainer
            label="Kelly Size" value={`${data.position_size_pct ?? 0}%`}
            what="Kelly % tells you exactly what fraction of your trading account to put into this single trade. It's a mathematical formula that maximises long-run growth without risking ruin. If Kelly says 0%, the math says skip the trade entirely."
            now={kellyCfg.now} action={kellyCfg.action} status={kellyCfg.status}
          >
            <div className="text-center p-2 cursor-help w-full"
              style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--text-muted)",
                borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                Kelly Size
              </div>
              <div className="text-sm font-bold num" style={{ color: (data.position_size_pct ?? 0) === 0 ? "var(--red)" : "var(--green)" }}>
                {data.position_size_pct ?? 0}%
              </div>
            </div>
          </MetricExplainer>

          <MetricExplainer
            label="Expected Return" value={fmtPct(data.expected_return ?? 0)}
            what="Expected Return is the model's best guess at how much this trade will return over the holding period, based on historical patterns and current signals. It's not guaranteed — but it represents the statistical edge."
            now={erCfg.now} action={erCfg.action} status={erCfg.status}
          >
            <div className="text-center p-2 cursor-help w-full"
              style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--text-muted)",
                borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                Exp. Gain
              </div>
              <div className="text-sm font-bold num"
                style={{ color: (data.expected_return ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                {fmtPct(data.expected_return ?? 0)}
              </div>
            </div>
          </MetricExplainer>
        </div>

        {onCompare && (
          <button
            onClick={onCompare}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6, padding: "6px", background: "transparent", border: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 10,
              fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--blue)"; e.currentTarget.style.color = "var(--blue)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <GitCompare className="h-3 w-3" /> Compare with others
          </button>
        )}
      </div>

      {/* ── Sub-signals ── */}
      <div className="panel" style={{ overflow: "visible" }}>
        <div className="panel-header">
          <span>What Each Model Says</span>
          <MetricExplainer
            label="Market Regime" value={(data.regime ?? "").replace(/_/g, " ")}
            what="The regime is the overall market 'weather' for this stock. It determines which sub-signals the system trusts most."
            now={regCfg.now} action={regCfg.action} status={regCfg.status}
          >
            <span className="badge badge-blue cursor-help"
              style={{ borderBottom: "1px dashed rgba(255,255,255,0.3)" }}>
              {(data.regime ?? "").replace(/_/g, " ")}
            </span>
          </MetricExplainer>
        </div>
        <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px", overflow: "visible" }}>
          {(data.signals ?? []).length === 0 ? (
            <div className="text-center py-8">
              <Minus className="h-5 w-5 mx-auto mb-2" style={{ color: "var(--text-disabled)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>No active sub-signals</p>
            </div>
          ) : (data.signals ?? []).map((s, i) => {
            const sc  = s.direction === 1 ? "var(--green)" : s.direction === -1 ? "var(--red)" : "var(--yellow)";
            const sb  = s.direction === 1 ? "var(--green-dim)" : s.direction === -1 ? "var(--red-dim)" : "var(--yellow-dim)";
            const src = s.source;
            const dirWord = s.direction === 1 ? "LONG" : s.direction === -1 ? "SHORT" : "FLAT";
            const now = `The ${SOURCE_LABEL[src] ?? src} model is saying ${dirWord} with ${(s.confidence * 100).toFixed(0)}% certainty. Stop: $${fmt(s.stop_loss)} · Target: $${fmt(s.take_profit)}.`;
            const action = s.direction === 1
              ? `This model supports the LONG case. Stop loss at $${fmt(s.stop_loss)}, take profit at $${fmt(s.take_profit)}.`
              : s.direction === -1
              ? `This model says sell / go short. If you're long, this is a warning.`
              : "This model has no edge right now — it's neutral.";
            const status: Status = s.direction === 1 ? "green" : s.direction === -1 ? "red" : "neutral";
            return (
              <MetricExplainer key={i}
                label={SOURCE_LABEL[src] ?? src} value={dirWord}
                what={SOURCE_WHAT[src] ?? "A sub-signal model."}
                now={now} action={action} status={status}
                wide
              >
                <div className="flex items-center justify-between p-2 w-full cursor-help"
                  style={{ background: sb, border: `1px solid ${sc}33` }}>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--text-primary)",
                      fontFamily: FONT_BODY, borderBottom: "1px dashed rgba(255,255,255,0.2)",
                      paddingBottom: "1px", display: "inline-block" }}>
                      {SOURCE_LABEL[src] ?? src}
                    </div>
                    <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)", fontFamily: FONT_MONO }}>
                      Stop ${fmt(s.stop_loss)} · Target ${fmt(s.take_profit)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold" style={{ color: sc }}>{dirWord}</div>
                    <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{(s.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </MetricExplainer>
            );
          })}
        </div>
      </div>

      {/* ── Risk & Monte Carlo ── */}
      <div className="panel" style={{ overflow: "visible" }}>
        <div className="panel-header">
          <span>Risk &amp; Win Probability</span>
          <Shield className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
        </div>
        <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px", overflow: "visible" }}>
          <div className="grid grid-cols-2 gap-1.5">
            {/* Sharpe */}
            <MetricExplainer
              label="Sharpe Ratio" value={fmt(data.risk_metrics?.sharpe ?? 0)}
              what="The Sharpe ratio measures how much profit you earned per unit of risk taken. A Sharpe of 1.0 means you earned exactly 1 dollar of profit for every dollar of risk. Above 2 is outstanding. Below 0 means you lost money relative to your risk."
              now={sharpeConfig(data.risk_metrics?.sharpe ?? 0, sym).now}
              action={sharpeConfig(data.risk_metrics?.sharpe ?? 0, sym).action}
              status={sharpeConfig(data.risk_metrics?.sharpe ?? 0, sym).status}
            >
              <div className="p-2 cursor-help w-full"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-muted)",
                  borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                  Sharpe
                </div>
                <div className="text-xs font-semibold num mt-0.5"
                  style={{ color: (data.risk_metrics?.sharpe ?? 0) >= 1 ? "var(--green)" : (data.risk_metrics?.sharpe ?? 0) >= 0.5 ? "var(--yellow)" : "var(--red)" }}>
                  {fmt(data.risk_metrics?.sharpe ?? 0)}
                </div>
              </div>
            </MetricExplainer>

            {/* Sortino */}
            <MetricExplainer
              label="Sortino Ratio" value={fmt(data.risk_metrics?.sortino ?? 0)}
              what="Like Sharpe, but it only counts downside moves as 'risk' — upward swings aren't penalised. A high Sortino means the stock went up a lot and down only a little. It's often considered more useful than Sharpe for traders."
              now={`Sortino of ${fmt(data.risk_metrics?.sortino ?? 0)}. ${(data.risk_metrics?.sortino ?? 0) >= 1 ? "Downside risk is well controlled relative to gains." : "Gains haven't significantly outpaced downside moves."}`}
              action={(data.risk_metrics?.sortino ?? 0) >= 1 ? "Good downside profile. Losses have been limited relative to gains." : "Downside risk is notable. Use a stop loss to protect your capital."}
              status={(data.risk_metrics?.sortino ?? 0) >= 1 ? "green" : (data.risk_metrics?.sortino ?? 0) >= 0.5 ? "blue" : "yellow"}
            >
              <div className="p-2 cursor-help w-full"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-muted)",
                  borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                  Sortino
                </div>
                <div className="text-xs font-semibold num mt-0.5"
                  style={{ color: (data.risk_metrics?.sortino ?? 0) >= 1 ? "var(--green)" : "var(--yellow)" }}>
                  {fmt(data.risk_metrics?.sortino ?? 0)}
                </div>
              </div>
            </MetricExplainer>

            {/* Max DD */}
            <MetricExplainer
              label="Max Drawdown" value={`−${((data.risk_metrics?.max_drawdown ?? 0) * 100).toFixed(1)}%`}
              what="Max Drawdown is the biggest historical drop from a peak to a bottom before recovery. It shows you the 'worst case hole' you might have to sit through. The smaller the number (closer to 0%), the safer the trade historically."
              now={ddCfg.now} action={ddCfg.action} status={ddCfg.status}
            >
              <div className="p-2 cursor-help w-full"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-muted)",
                  borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                  Max DD
                </div>
                <div className="text-xs font-semibold num mt-0.5" style={{ color: "var(--red)" }}>
                  {fmtPct(-(data.risk_metrics?.max_drawdown ?? 0) * 100)}
                </div>
              </div>
            </MetricExplainer>

            {/* Ann Vol */}
            <MetricExplainer
              label="Annual Volatility" value={`${((data.risk_metrics?.volatility_ann ?? 0)).toFixed(1)}%`}
              what="Annual Volatility is the typical yearly range of swings this stock has. 20% means the stock typically moves ±20% in a year. Higher volatility = more risk but also more opportunity. For day trading, higher vol stocks offer bigger intraday moves."
              now={`Annualised volatility is ${((data.risk_metrics?.volatility_ann ?? 0)).toFixed(1)}%. ${(data.risk_metrics?.volatility_ann ?? 0) > 40 ? "This is a high-volatility stock with big daily swings." : (data.risk_metrics?.volatility_ann ?? 0) > 20 ? "Moderate volatility — normal for an active stock." : "Low volatility — calm, steady movements."}`}
              action={(data.risk_metrics?.volatility_ann ?? 0) > 40 ? "Size smaller than normal. Big volatility = big potential loss too. Use ATR to set your stop loss." : "Standard sizing is fine. Volatility is within normal range."}
              status={(data.risk_metrics?.volatility_ann ?? 0) > 50 ? "yellow" : "blue"}
            >
              <div className="p-2 cursor-help w-full"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-muted)",
                  borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "2px", marginBottom: "3px" }}>
                  Ann Vol
                </div>
                <div className="text-xs font-semibold num mt-0.5" style={{ color: "var(--text-primary)" }}>
                  {fmtPct(data.risk_metrics?.volatility_ann ?? 0)}
                </div>
              </div>
            </MetricExplainer>
          </div>

          {/* MC Prob */}
          {data.monte_carlo && Object.keys(data.monte_carlo).length > 0 && (
            <MetricExplainer
              label="MC Profit Probability" value={`${data.monte_carlo.prob_positive ?? 0}%`}
              what="Monte Carlo simulation runs 500 different possible futures for this stock, based on its historical behaviour. It then counts how many of those 500 futures end profitably. 70% means 350 out of 500 simulated paths end with a gain."
              now={mcCfg.now} action={mcCfg.action} status={mcCfg.status}
              wide
            >
              <div style={{ cursor: "help" }}>
                <div className="text-[9px] uppercase tracking-widest mb-2"
                  style={{ color: "var(--text-muted)", fontFamily: FONT_BODY,
                    borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "3px",
                    display: "inline-block" }}>
                  Win Probability — 500 simulated futures
                </div>
                <MonteCarloChart mc={data.monte_carlo} />
              </div>
            </MetricExplainer>
          )}
        </div>
      </div>
    </div>
  );
}
