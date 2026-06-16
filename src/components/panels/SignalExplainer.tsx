"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, Target, Shield, DollarSign } from "lucide-react";
import type { AnalysisResult } from "@/types/quant";
import { useTrader } from "@/store/trader";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SignalExplainer({ data }: { data: AnalysisResult }) {
  const portfolioCapital = useTrader(s => s.portfolioCapital);
  const [open, setOpen] = useState(true);
  // Seed from persisted portfolio capital so the beginner sees their own numbers immediately
  const [accountSize, setAccountSize] = useState(() => portfolioCapital ?? 10_000);

  const sig   = data.composite_signal;
  const conf  = data.composite_confidence ?? 0;
  const price = data.price ?? 0;
  const kelly = (data.position_size_pct ?? 0) / 100;

  // Dollar sizing
  const dollarAlloc  = accountSize * kelly;
  const shares       = price > 0 ? Math.floor(dollarAlloc / price) : 0;
  const actualDollar = shares * price;

  // Best stop/target from highest-confidence sub-signal matching composite direction
  const bestSignal = [...(data.signals ?? [])]
    .filter(s => s.direction === sig)
    .sort((a, b) => b.confidence - a.confidence)[0];

  // stop_loss and take_profit from engine are absolute price levels when > 10, else multipliers
  const toAbsPrice = (v: number) => v > 10 ? v : price * v;
  const stopAbs   = bestSignal?.stop_loss   ? toAbsPrice(bestSignal.stop_loss)   : null;
  const targetAbs = bestSignal?.take_profit ? toAbsPrice(bestSignal.take_profit) : null;
  const stopDollar  = stopAbs   && shares > 0 ? (stopAbs   - price) * shares : null;
  const gainDollar  = targetAbs && shares > 0 ? (targetAbs - price) * shares : null;

  const accentColor = sig === 1 ? "var(--green)" : sig === -1 ? "var(--red)" : "var(--yellow)";
  const accentBg    = sig === 1 ? "var(--green-dim)" : sig === -1 ? "var(--red-dim)" : "var(--yellow-dim)";

  const headline =
    sig === 1  ? `Buy opportunity — ${data.symbol} shows ${(conf * 100).toFixed(0)}% confidence LONG` :
    sig === -1 ? `Caution — ${data.symbol} signals ${(conf * 100).toFixed(0)}% confidence SHORT/exit` :
                 `No clear edge in ${data.symbol} right now`;

  const regimeNote = (() => {
    const r = data.regime ?? "";
    if (r.includes("trending_up"))   return "Trend is up — momentum favours longs.";
    if (r.includes("trending_down"))  return "Trend is down — risk is elevated.";
    if (r.includes("mean_reverting")) return "Mean-reverting — expect swings around fair value.";
    if (r.includes("volatile"))       return "High-volatility — size conservatively.";
    return "Quiet regime — signals carry less conviction.";
  })();

  return (
    <div className="panel overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
        style={{ background: accentBg }}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accentColor }} />
          <span className="text-xs font-semibold" style={{ color: accentColor, fontFamily: FONT_BODY }}>
            {headline}
          </span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accentColor }} />
          : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accentColor }} />
        }
      </button>

      {open && (
        <div>
          {/* Account size row */}
          <div className="flex items-center gap-3 px-3 py-2"
            style={{ background: "var(--bg-raised)", borderBottom: "1px solid var(--border)" }}>
            <DollarSign className="h-3 w-3 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              Your account:
            </span>
            <div className="flex items-center"
              style={{ background: "#FFFFFF", border: "1px solid var(--border)", borderRadius: 0 }}>
              <span className="px-1.5 text-xs" style={{ color: "var(--text-muted)" }}>$</span>
              <input
                type="number"
                value={accountSize}
                onChange={e => setAccountSize(Math.max(100, Number(e.target.value)))}
                className="bg-transparent outline-none text-xs num py-1 pr-2 w-24"
                style={{ color: "var(--text-primary)", fontFamily: FONT_MONO }}
              />
            </div>
            <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-disabled)" }}>
              used to calculate share count and dollar risk
            </span>
          </div>

          {sig !== 0 && price > 0 ? (
            <>
              {/* Three-column trade brief */}
              <div className="p-3">
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600, letterSpacing: "0.16em",
                  textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "10px" }}>
                  Concrete Trade Brief
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">

                  {/* Entry */}
                  <div style={{ background: accentBg, border: `1px solid ${accentColor}33`, padding: "10px 12px" }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                      letterSpacing: "0.14em", textTransform: "uppercase", color: accentColor, marginBottom: "6px" }}>
                      {sig === 1 ? "▲ Entry — Buy" : "▼ Entry — Sell / Exit"}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: "20px", fontWeight: 700,
                      color: "var(--text-primary)", lineHeight: 1 }}>
                      {shares > 0 ? `${shares} shares` : "< 1 share"}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: "12px",
                      color: "var(--text-secondary)", marginTop: "3px" }}>
                      @ {fmt$(price)} = {fmt$(actualDollar)}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: "10px",
                      color: "var(--text-muted)", marginTop: "4px" }}>
                      {(data.position_size_pct ?? 0)}% Kelly of {fmt$(accountSize)}
                    </div>
                  </div>

                  {/* Stop */}
                  <div style={{ background: "var(--red-dim)", border: "1px solid var(--red)33", padding: "10px 12px" }}>
                    <div className="flex items-center gap-1" style={{ fontFamily: FONT_BODY, fontSize: "9px",
                      fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
                      color: "var(--red)", marginBottom: "6px" }}>
                      <Shield className="h-2.5 w-2.5" /> Stop Loss
                    </div>
                    {stopAbs ? (
                      <>
                        <div style={{ fontFamily: FONT_MONO, fontSize: "20px", fontWeight: 700,
                          color: "var(--red)", lineHeight: 1 }}>
                          {fmt$(stopAbs)}
                        </div>
                        <div style={{ fontFamily: FONT_MONO, fontSize: "12px",
                          color: "var(--text-secondary)", marginTop: "3px" }}>
                          {stopDollar !== null
                            ? (stopDollar < 0 ? `−${fmt$(Math.abs(stopDollar))}` : `+${fmt$(stopDollar)}`)
                            : "—"} max loss
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: "10px",
                          color: "var(--text-muted)", marginTop: "4px" }}>
                          {stopAbs < price
                            ? `−${((1 - stopAbs / price) * 100).toFixed(1)}%`
                            : `+${((stopAbs / price - 1) * 100).toFixed(1)}%`} from entry
                        </div>
                      </>
                    ) : (
                      <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-disabled)", lineHeight: 1.5 }}>
                        Set manually at 1–2× ATR below entry
                      </div>
                    )}
                  </div>

                  {/* Target */}
                  <div style={{ background: "var(--green-dim)", border: "1px solid var(--green)33", padding: "10px 12px" }}>
                    <div className="flex items-center gap-1" style={{ fontFamily: FONT_BODY, fontSize: "9px",
                      fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
                      color: "var(--green)", marginBottom: "6px" }}>
                      <Target className="h-2.5 w-2.5" /> Take Profit
                    </div>
                    {targetAbs ? (
                      <>
                        <div style={{ fontFamily: FONT_MONO, fontSize: "20px", fontWeight: 700,
                          color: "var(--green)", lineHeight: 1 }}>
                          {fmt$(targetAbs)}
                        </div>
                        <div style={{ fontFamily: FONT_MONO, fontSize: "12px",
                          color: "var(--text-secondary)", marginTop: "3px" }}>
                          +{fmt$(Math.abs(gainDollar ?? 0))} potential gain
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: "10px",
                          color: "var(--text-muted)", marginTop: "4px" }}>
                          {targetAbs > price
                            ? `+${((targetAbs / price - 1) * 100).toFixed(1)}%`
                            : `−${((1 - targetAbs / price) * 100).toFixed(1)}%`} from entry
                        </div>
                      </>
                    ) : (
                      <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-disabled)", lineHeight: 1.5 }}>
                        Target 2–3× your stop distance
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* R:R bar */}
              <div className="mx-3 mb-3 px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-1"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                {stopAbs && targetAbs && stopDollar !== null && gainDollar !== null && (
                  <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-secondary)" }}>
                    Risk/Reward:{" "}
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: "var(--text-primary)" }}>
                      1 : {Math.abs(stopDollar) > 0
                        ? (Math.abs(gainDollar) / Math.abs(stopDollar)).toFixed(1)
                        : "—"}
                    </span>
                  </span>
                )}
                <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-secondary)" }}>
                  MC Profit probability:{" "}
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700,
                    color: (data.monte_carlo?.prob_positive ?? 0) > 55 ? "var(--green)" : "var(--yellow)" }}>
                    {data.monte_carlo?.prob_positive ?? "—"}%
                  </span>
                </span>
                <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-secondary)" }}>
                  Worst 21d MC DD:{" "}
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: "var(--red)" }}>
                    −{data.monte_carlo?.worst_dd ?? "—"}%
                  </span>
                </span>
              </div>
            </>
          ) : (
            <div className="px-3 py-5 text-center">
              <p style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                No actionable edge detected. Sub-signals are mixed or below the confidence threshold.
                <br />
                Use the Backtest tab to study historical performance while waiting for clarity.
              </p>
            </div>
          )}

          {/* Regime note */}
          <div className="px-3 pb-3 flex items-start justify-between gap-4 flex-wrap"
            style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
            <p style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-secondary)" }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Regime: </span>
              {regimeNote}
            </p>
            <p style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-disabled)", flexShrink: 0 }}>
              Not financial advice. Past performance does not guarantee future results.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
