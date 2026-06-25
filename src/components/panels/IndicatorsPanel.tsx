"use client";

import { MetricExplainer } from "@/components/ui/Tooltip";
import type { Indicators } from "@/types/quant";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type Status = "green" | "yellow" | "red" | "blue" | "neutral";

function Row({
  label, value, displayValue, bar, what, now, action, status,
}: {
  label: string;
  value: number;
  displayValue: string;
  bar: number;   // 0–100
  what: string;
  now: string;
  action: string;
  status: Status;
}) {
  const barColor =
    status === "green"   ? "var(--green)" :
    status === "red"     ? "var(--red)"   :
    status === "yellow"  ? "var(--yellow)":
    status === "blue"    ? "var(--blue)"  : "var(--text-muted)";

  return (
    <MetricExplainer
      label={label} value={displayValue}
      what={what} now={now} action={action} status={status}
    >
      <div style={{ width: "100%", cursor: "help" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
          <span style={{
            fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 500,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            borderBottom: "1px dashed rgba(255,255,255,0.15)",
          }}>
            {label}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700, color: barColor }}>
            {displayValue}
          </span>
        </div>
        <div style={{ height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: 0 }}>
          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, bar))}%`,
            background: barColor, transition: "width 0.4s ease" }} />
        </div>
      </div>
    </MetricExplainer>
  );
}

// ── Per-metric explanation factories ────────────────────────────────────────

function rsiConfig(rsi: number): { bar: number; what: string; now: string; action: string; status: Status } {
  const bar = rsi; // 0–100 natural
  const what =
    "RSI stands for Relative Strength Index. It measures whether a stock has been bought too much (overbought) or sold too much (oversold) recently. Think of it like a rubber band: the further it stretches, the more likely it is to snap back.";
  let now: string, action: string, status: Status;
  if (rsi < 30) {
    now = `RSI is ${rsi.toFixed(0)} — the stock is oversold. It has been sold hard and may be due for a bounce upward.`;
    action = "This is often a buying opportunity. Watch for a signal flip to LONG and consider entering a long position.";
    status = "green";
  } else if (rsi > 70) {
    now = `RSI is ${rsi.toFixed(0)} — the stock is overbought. Too many people bought recently; a pullback is possible.`;
    action = "If you're already in a long trade, consider taking some profit or tightening your stop loss. Avoid new long entries here.";
    status = "red";
  } else if (rsi >= 55) {
    now = `RSI is ${rsi.toFixed(0)} — in the upper-neutral zone. The stock has upward momentum but isn't dangerously stretched yet.`;
    action = "Momentum is on your side for a long trade. Watch for RSI moving above 70 as a cue to prepare your exit.";
    status = "green";
  } else if (rsi <= 45) {
    now = `RSI is ${rsi.toFixed(0)} — slightly weak. The stock has been drifting lower but isn't oversold yet.`;
    action = "Be cautious entering a long here unless other signals are very strong. Wait for RSI to stabilize or bounce.";
    status = "yellow";
  } else {
    now = `RSI is ${rsi.toFixed(0)} — neutral territory. No strong overbought or oversold pressure right now.`;
    action = "RSI alone gives no clear edge here. Look at Signal, Confidence, and Regime to make your decision.";
    status = "blue";
  }
  return { bar, what, now, action, status };
}

function bbConfig(bb: number): { bar: number; what: string; now: string; action: string; status: Status } {
  // bb_pct is -1 to +1 in raw form; displayed as × 100 → -100 to 100
  const bar = ((bb / 100) + 1) / 2 * 100; // map -100..100 → 0..100
  const what =
    "Bollinger Bands are like a price channel drawn around the stock. The %B tells you where the current price sits inside that channel. 0% = at the very bottom of the channel, 100% = at the very top.";
  let now: string, action: string, status: Status;
  if (bb < -80) {
    now = `%B is ${bb.toFixed(0)}% — price is at or below the bottom of its Bollinger Band. Extremely oversold on a short-term basis.`;
    action = "Classic mean-reversion buy signal. Strong candidates for a bounce. Combine with LONG signal for high conviction entry.";
    status = "green";
  } else if (bb > 80) {
    now = `%B is ${bb.toFixed(0)}% — price is at or above the top of its Bollinger Band. Extremely stretched to the upside.`;
    action = "Take profit on longs or tighten your stop. Avoid buying here — the rubber band is fully stretched.";
    status = "red";
  } else if (bb < -30) {
    now = `%B is ${bb.toFixed(0)}% — price is in the lower half of the channel. Slightly weak.`;
    action = "Potential for a bounce if signal is LONG. Not extreme enough to act on Bollinger Bands alone.";
    status = "yellow";
  } else if (bb > 30) {
    now = `%B is ${bb.toFixed(0)}% — price is in the upper half of the channel. Slightly extended.`;
    action = "OK for holding existing longs, but be aware a pullback is more likely than further gains.";
    status = "yellow";
  } else {
    now = `%B is ${bb.toFixed(0)}% — price is near the middle of its Bollinger Band. No stretch in either direction.`;
    action = "Neutral. Bollinger Bands aren't giving you a strong signal right now. Let other indicators guide you.";
    status = "blue";
  }
  return { bar, what, now, action, status };
}

function hurstConfig(h: number): { bar: number; what: string; now: string; action: string; status: Status } {
  const bar = ((h - 0.3) / 0.4) * 100;
  const what =
    "The Hurst Exponent tells you what TYPE of market behaviour this stock is showing right now. Is it trending (what goes up keeps going up)? Is it random? Or is it mean-reverting (prices bounce back to average)? Values above 0.6 mean trending, below 0.4 mean bouncy/reversing, and 0.5 means random.";
  let now: string, action: string, status: Status;
  if (h >= 0.6) {
    now = `Hurst is ${h.toFixed(3)} — clearly trending. The stock is behaving like a trending asset right now. Momentum-based signals are more reliable.`;
    action = "Trend-following and momentum strategies work best here. If the signal is LONG, ride the trend. Set a trailing stop so you don't give back all your gains.";
    status = "green";
  } else if (h >= 0.5) {
    now = `Hurst is ${h.toFixed(3)} — mild trend tendency. Some trending behaviour but not strongly directional.`;
    action = "Signals are valid but slightly less reliable. Confirm with RSI and volume before entering.";
    status = "blue";
  } else if (h >= 0.4) {
    now = `Hurst is ${h.toFixed(3)} — near-random. The stock is switching between trending and reversing. Signals are noisier than usual.`;
    action = "Reduce position size. The model's signals are less reliable when Hurst is near 0.5. Wait for a clearer regime.";
    status = "yellow";
  } else {
    now = `Hurst is ${h.toFixed(3)} — mean-reverting. When this stock moves up, it tends to come back down, and vice versa.`;
    action = "Mean-reversion strategies work best. Look for RSI extremes (< 30 or > 70) to time entries and exits rather than chasing momentum.";
    status = "yellow";
  }
  return { bar, what, now, action, status };
}

function volAdvConfig(v: number): { bar: number; what: string; now: string; action: string; status: Status } {
  const bar = Math.min(100, (v / 3) * 100);
  const what =
    "This compares today's trading volume to the stock's 20-day average volume (ADV = Average Daily Volume). 1.0× means normal. 2.0× means twice as many shares are trading hands today as usual. Volume is like the crowd at a game — big crowd means something interesting is happening.";
  let now: string, action: string, status: Status;
  if (v >= 1.5) {
    now = `Volume is ${v.toFixed(2)}× the 20-day average — significantly above normal. Something is drawing attention to this stock today.`;
    action = "High volume confirms the signal. Institutions and big players are actively trading this. Your buy/sell orders will fill easily with minimal price impact.";
    status = "green";
  } else if (v >= 0.8) {
    now = `Volume is ${v.toFixed(2)}× normal — close to average. Standard trading activity today.`;
    action = "Normal conditions. Your orders will fill fine. No special concern about volume.";
    status = "blue";
  } else if (v >= 0.5) {
    now = `Volume is ${v.toFixed(2)}× normal — below average. Fewer people are trading this today.`;
    action = "Be cautious with large orders — low volume means your trade can move the price. Consider trading a smaller size.";
    status = "yellow";
  } else {
    now = `Volume is ${v.toFixed(2)}× normal — very thin trading today. This stock is unusually quiet.`;
    action = "Avoid trading this today unless it's a very small position. Low liquidity = large spreads and unpredictable fills.";
    status = "red";
  }
  return { bar, what, now, action, status };
}

function atrConfig(atr: number): { bar: number; what: string; now: string; action: string; status: Status } {
  const bar = Math.min(100, (atr / 0.05) * 100);
  const pct = (atr * 100).toFixed(2);
  const what =
    "ATR stands for Average True Range — it measures how many dollars (as a % of price) the stock typically moves in a single day. A high ATR means big swings. A low ATR means small, quiet moves. Think of it as the 'turbulence level' of flying in this stock.";
  let now: string, action: string, status: Status;
  if (atr > 0.04) {
    now = `ATR is ${pct}% — very high volatility. This stock is swinging ${pct}% on an average day. Big potential gains, but also big potential losses.`;
    action = "Size your position smaller than usual. Set wider stop losses (at least 1–2× ATR below entry) to avoid getting stopped out by normal noise.";
    status = "yellow";
  } else if (atr > 0.02) {
    now = `ATR is ${pct}% — moderate volatility. Normal daily swings for an active stock.`;
    action = "Standard sizing applies. Use ATR to set your stop loss: place it about 1.5× ATR below your entry price.";
    status = "blue";
  } else {
    now = `ATR is ${pct}% — low volatility. This stock is moving very little day to day.`;
    action = "Day trading potential is limited — small moves mean smaller profits. This is safer but slower. Good for beginners learning position sizing.";
    status = "green";
  }
  return { bar, what, now, action, status };
}

function momConfig(mom: number): { bar: number; what: string; now: string; action: string; status: Status } {
  const pct = (mom * 100).toFixed(1);
  const bar = Math.max(0, Math.min(100, ((mom + 0.3) / 0.6) * 100));
  const what =
    "12-1 Momentum measures how much the stock has gained over the past 12 months, minus the most recent month (to filter out short-term noise). This is one of the most proven signals in finance — stocks that have been going up for a year tend to keep going up for the next few months.";
  let now: string, action: string, status: Status;
  if (mom > 0.15) {
    now = `Momentum is +${pct}% — very strong. This stock has been a top performer over the past year and the trend is intact.`;
    action = "Strong fundamental tailwind for longs. The 'winners keep winning' effect is working in your favour. Hold longs and let profits run.";
    status = "green";
  } else if (mom > 0.05) {
    now = `Momentum is +${pct}% — positive. The stock has been trending upward over the past year.`;
    action = "Good backdrop for a long trade. Momentum is on your side.";
    status = "green";
  } else if (mom > -0.05) {
    now = `Momentum is ${pct}% — flat. No strong directional trend over the past year.`;
    action = "Neutral. Don't use momentum as a reason to buy or sell — rely on shorter-term signals instead.";
    status = "blue";
  } else if (mom > -0.15) {
    now = `Momentum is ${pct}% — negative. This stock has underperformed over the past year.`;
    action = "Be cautious with long positions. This stock has been a loser — go against that trend only with very high conviction signals.";
    status = "yellow";
  } else {
    now = `Momentum is ${pct}% — strongly negative. This stock has been a significant loser over the past year.`;
    action = "Avoid long positions unless the signal is overwhelmingly LONG with high Kelly %. This is a fallen knife — short setups are more aligned with the trend.";
    status = "red";
  }
  return { bar, what, now, action, status };
}

function emaConfig(ema: number): { bar: number; what: string; now: string; action: string; status: Status } {
  // ema displayed ×1000
  const bar = Math.max(0, Math.min(100, ((ema + 5) / 10) * 100));
  const what =
    "The EMA Spread compares the fast 8-day moving average to the slower 21-day moving average. When the fast line is above the slow line, the stock is in a short-term uptrend. When it crosses below, the trend has shifted down. Think of it as two runners — if the sprinter (8-day) is ahead of the jogger (21-day), the stock is accelerating.";
  let now: string, action: string, status: Status;
  if (ema > 2) {
    now = `EMA spread is +${ema.toFixed(1)} — the fast average is well above the slow average. Strong short-term uptrend.`;
    action = "Clear uptrend in place. Good environment for long entries. Watch for the spread to narrow as a warning sign the trend is losing steam.";
    status = "green";
  } else if (ema > 0) {
    now = `EMA spread is +${ema.toFixed(1)} — the fast average is slightly above the slow average. Mild upward bias.`;
    action = "Slight tailwind for longs. This alone isn't enough to enter — wait for confluence with Signal and RSI.";
    status = "blue";
  } else if (ema > -2) {
    now = `EMA spread is ${ema.toFixed(1)} — the fast average has crossed below the slow average. Short-term trend has turned negative.`;
    action = "Be cautious with long positions. This is a bearish crossover signal. Tighten your stop loss or reduce size.";
    status = "yellow";
  } else {
    now = `EMA spread is ${ema.toFixed(1)} — the fast average is well below the slow average. Clear short-term downtrend.`;
    action = "Avoid new long positions. If you're long, this is a red flag — consider exiting unless your other signals are very strong.";
    status = "red";
  }
  return { bar, what, now, action, status };
}

// ── Main component ───────────────────────────────────────────────────────────

export function IndicatorsPanel({
  indicators: ind,
  oosSharp,
  featureImportance,
}: {
  indicators: Indicators;
  oosSharp?: number;
  featureImportance?: [string, number][];
}) {
  const rsi  = rsiConfig(ind.rsi_14 ?? 50);
  const bb   = bbConfig((ind.bb_pct ?? 0) * 100);
  const hst  = hurstConfig(ind.hurst ?? 0.5);
  const vol  = volAdvConfig(ind.vol_adv_ratio ?? 1);
  const atr  = atrConfig(ind.atr_pct ?? 0.02);
  const mom  = momConfig(ind.mom_12_1 ?? 0);
  const ema  = emaConfig((ind.ema_8_21_spread ?? 0) * 1000);

  const hurstLabel =
    (ind.hurst ?? 0.5) > 0.6 ? "Trending" :
    (ind.hurst ?? 0.5) < 0.4 ? "Mean-Reverting" : "Mixed";
  const hurstColor =
    (ind.hurst ?? 0.5) > 0.6 ? "var(--green)" :
    (ind.hurst ?? 0.5) < 0.4 ? "var(--yellow)" : "var(--text-secondary)";

  return (
    <div className="panel" style={{ overflow: "visible" }}>
      <div className="panel-header">
        <span>Technical Indicators</span>
        <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
          HOVER FOR PLAIN-ENGLISH GUIDE
        </span>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "10px", overflow: "visible" }}>
        <Row label="RSI (14)"           value={ind.rsi_14 ?? 50}                       displayValue={`${(ind.rsi_14 ?? 50).toFixed(0)}`}         {...rsi}  />
        <Row label="Bollinger %B"       value={(ind.bb_pct ?? 0) * 100}                displayValue={`${((ind.bb_pct ?? 0) * 100).toFixed(0)}%`}  {...bb}   />
        <Row label="Hurst Exponent"     value={ind.hurst ?? 0.5}                       displayValue={`${(ind.hurst ?? 0.5).toFixed(3)}`}          {...hst}  />
        <Row label="Volume / ADV"       value={ind.vol_adv_ratio ?? 1}                 displayValue={`${(ind.vol_adv_ratio ?? 1).toFixed(2)}×`}   {...vol}  />
        <Row label="ATR %"              value={ind.atr_pct ?? 0}                       displayValue={`${((ind.atr_pct ?? 0) * 100).toFixed(2)}%`} {...atr}  />
        <Row label="Momentum 12-1"      value={ind.mom_12_1 ?? 0}                      displayValue={`${((ind.mom_12_1 ?? 0) * 100).toFixed(1)}%`} {...mom} />
        <Row label="EMA 8/21 Spread"    value={(ind.ema_8_21_spread ?? 0) * 1000}      displayValue={`${((ind.ema_8_21_spread ?? 0) * 1000).toFixed(2)}`} {...ema} />
      </div>

      {/* Regime summary */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "6px 12px",
        background: "var(--bg-raised)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
          Hurst regime:
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700, color: hurstColor }}>
          {hurstLabel}
        </span>
      </div>

      {/* ML model explainability card */}
      {(oosSharp !== undefined || (featureImportance && featureImportance.length > 0)) && (
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "8px 12px",
          background: "rgba(59,130,246,0.04)",
        }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: "9px", letterSpacing: "0.1em",
            textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: "6px" }}>
            ML Model (GBM · Hold-Out Eval)
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
            {oosSharp !== undefined && (
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "rgba(255,255,255,0.35)", marginBottom: "2px" }}>
                  OOS Sharpe
                </div>
                <div style={{
                  fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
                  color: oosSharp >= 0.5 ? "var(--green)" : oosSharp >= 0 ? "var(--yellow)" : "var(--red)",
                }}>
                  {oosSharp >= 0 ? "+" : ""}{oosSharp.toFixed(2)}
                </div>
              </div>
            )}
            {featureImportance && featureImportance.length > 0 && (
              <div style={{ flex: 1, minWidth: "120px" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>
                  Top drivers
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {featureImportance.map(([name, imp]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{
                        height: "3px", background: "var(--blue)", opacity: 0.7,
                        width: `${Math.round(imp * 200)}px`, maxWidth: "80px", minWidth: "4px",
                        transition: "width 0.4s",
                      }} />
                      <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "rgba(255,255,255,0.5)" }}>
                        {name.replace(/_/g, " ")}
                      </span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "rgba(255,255,255,0.3)", marginLeft: "auto" }}>
                        {(imp * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
