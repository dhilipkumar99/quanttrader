"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { IndicatorGauge } from "@/components/charts/IndicatorGauge";
import type { Indicators } from "@/types/quant";

interface Props {
  indicators: Indicators;
}

const TIPS = {
  rsi: "Relative Strength Index (14 bars). Above 70 = overbought (may fall). Below 30 = oversold (may rise). Between 30–70 = neutral.",
  bb:  "Bollinger %B: how far the current price is from the centre of its Bollinger Band. Above 1 = extended high, below 0 = extended low.",
  hurst: "Hurst Exponent: measures trend persistence. Above 0.6 = trending market. Below 0.4 = mean-reverting. Near 0.5 = random/unpredictable.",
  voladv: "Today's volume relative to the 20-day average daily volume (ADV). High values indicate unusual trading activity — often precedes big moves.",
  atr: "Average True Range as a % of price. Measures daily volatility. High ATR = bigger price swings expected.",
  mom: "12-1 Momentum: the return from 12 months ago to 1 month ago. Positive = stock was rising; negative = was falling.",
  ema: "The gap between the 8-day and 21-day EMA (×1000 for readability). Positive = short-term average above long-term = bullish; negative = bearish.",
};

export function IndicatorsPanel({ indicators: ind }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Technical Indicators</CardTitle>
        <span className="text-[10px] text-zinc-600 hidden sm:inline">Hover the ? for plain-English explanations</span>
      </CardHeader>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <IndicatorGauge
          label="RSI (14)"
          value={ind.rsi_14}
          min={0}
          max={100}
          invertColor
          tooltip={TIPS.rsi}
        />
        <IndicatorGauge
          label="Bollinger %B"
          value={ind.bb_pct * 100}
          min={-100}
          max={100}
          tooltip={TIPS.bb}
        />
        <IndicatorGauge
          label="Hurst Exponent"
          value={ind.hurst}
          min={0.3}
          max={0.7}
          tooltip={TIPS.hurst}
        />
        <IndicatorGauge
          label="Volume / ADV"
          value={ind.vol_adv_ratio}
          min={0}
          max={3}
          tooltip={TIPS.voladv}
        />
        <IndicatorGauge
          label="ATR %"
          value={ind.atr_pct}
          min={0}
          max={5}
          invertColor
          tooltip={TIPS.atr}
        />
        <IndicatorGauge
          label="Momentum 12-1 (%)"
          value={ind.mom_12_1}
          min={-30}
          max={30}
          tooltip={TIPS.mom}
        />
        <div className="col-span-2">
          <IndicatorGauge
            label="EMA 8/21 Spread (×1000)"
            value={ind.ema_8_21_spread * 1000}
            min={-5}
            max={5}
            tooltip={TIPS.ema}
          />
        </div>
      </div>

      <div className="mt-4 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          Hurst Interpretation
          <InfoTooltip content={TIPS.hurst} />
        </div>
        <div className="text-xs text-zinc-400">
          {ind.hurst > 0.6
            ? "H > 0.6 → Trending market (price tends to continue in the same direction). Trend-following signals are given more weight."
            : ind.hurst < 0.4
            ? "H < 0.4 → Mean-reverting market (price tends to snap back toward average). Mean-reversion signals are given more weight."
            : "H ≈ 0.5 → Random walk (no reliable pattern detected). Signal conviction is reduced; the ML ensemble takes the lead."}
        </div>
      </div>
    </Card>
  );
}
