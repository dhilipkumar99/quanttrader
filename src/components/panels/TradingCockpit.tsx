"use client";

/**
 * TradingCockpit — the beginner's action-plan HUD.
 * Light-theme aware: all text uses dark CSS vars, never hardcoded white.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, Shield, Target, Eye, LogOut, OctagonX } from "lucide-react";
import type { AnalysisResult } from "@/types/quant";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Colour constants (light-theme safe) ──────────────────────────────────────
const C = {
  green:  "#1A6B4A",
  red:    "#C41E3A",
  amber:  "#8B6914",
  blue:   "#0B1F3A",
  text:   "#1A1A1A",   // near-black body text
  muted:  "#5A5248",   // mid-grey
  faint:  "#8A8078",   // light-grey labels
};

// ── Sub-components ───────────────────────────────────────────────────────────

interface Step {
  num: number;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  status: "go" | "caution" | "stop" | "info";
}

function StepCard({ step }: { step: Step }) {
  const accent =
    step.status === "go"      ? C.green :
    step.status === "caution" ? C.amber :
    step.status === "stop"    ? C.red   : C.blue;
  const bg =
    step.status === "go"      ? "rgba(26,107,74,0.06)"  :
    step.status === "caution" ? "rgba(139,105,20,0.07)" :
    step.status === "stop"    ? "rgba(196,30,58,0.06)"  : "rgba(11,31,58,0.05)";

  return (
    <div style={{
      border: `1px solid ${accent}55`,
      background: bg,
      padding: "10px 12px",
      display: "flex", gap: "10px", alignItems: "flex-start",
    }}>
      {/* Number badge */}
      <div style={{
        width: "22px", height: "22px", flexShrink: 0,
        background: accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 800,
        color: "#FFFFFF", // white-on-colour badge — always readable
      }}>
        {step.num}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
          <span style={{ color: accent, display: "flex", alignItems: "center" }}>{step.icon}</span>
          <span style={{
            fontFamily: FONT_BODY, fontSize: "11px", fontWeight: 700,
            letterSpacing: "0.07em", textTransform: "uppercase", color: C.text,
          }}>
            {step.title}
          </span>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "12px", lineHeight: 1.7, color: C.text }}>
          {step.body}
        </div>
      </div>
    </div>
  );
}

/** Bold inline — dark text, not white */
function B({ children, color = C.text }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontWeight: 700, color }}>{children}</span>;
}

/** Mono number inline */
function N({ children, color = C.text }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color }}>{children}</span>;
}

// ── Main export ──────────────────────────────────────────────────────────────

export function TradingCockpit({ data, accountSize }: { data: AnalysisResult; accountSize: number }) {
  const [open, setOpen] = useState(true);

  const sig    = data.composite_signal;
  const conf   = data.composite_confidence ?? 0;
  const kelly  = data.position_size_pct ?? 0;
  const price  = data.price ?? 0;
  const er     = data.expected_return ?? 0;
  const sharpe = data.risk_metrics?.sharpe ?? 0;
  const mc     = data.monte_carlo?.prob_positive ?? 0;
  // atr_pct from engine is already a decimal (e.g. 0.0265 = 2.65%)
  const atrRaw  = data.indicators?.atr_pct ?? 0.02;
  // Treat values > 0.5 as already in percent form (legacy); otherwise multiply to get %
  const atrPct  = atrRaw > 0.5 ? atrRaw : atrRaw * 100;
  const rsi     = data.indicators?.rsi_14 ?? 50;
  const regime  = data.regime ?? "quiet";
  const sym     = data.symbol;

  // ── Position sizing ──────────────────────────────────────────────────
  const dollarAlloc  = accountSize * (kelly / 100);
  const shares       = price > 0 ? Math.floor(dollarAlloc / price) : 0;
  const actualDollar = shares * price;

  // Stop: 1.5× ATR, floored at 1.5%, capped at 8% (sane day-trade range)
  const stopPct     = Math.min(Math.max(atrPct * 1.5, 1.5), 8);
  const stopPrice   = sig === 1 ? price * (1 - stopPct / 100)
                    : sig === -1 ? price * (1 + stopPct / 100)
                    : price * (1 - stopPct / 100); // shown but greyed for FLAT
  const targetPct   = stopPct * 2.5;               // 2.5:1 R:R
  const targetPrice = sig === 1 ? price * (1 + targetPct / 100)
                    : sig === -1 ? price * (1 - targetPct / 100)
                    : price * (1 + targetPct / 100);
  const maxLoss     = shares * price * (stopPct / 100);

  // ── Step 1 — Stop loss commitment ────────────────────────────────────
  const stopStep: Step = {
    num: 1, icon: <OctagonX className="h-3.5 w-3.5" />,
    title: "Decide your exit before you enter",
    status: sig === 0 ? "info" : "stop",
    body: (
      <div>
        {sig === 0 ? (
          <p style={{ color: C.muted }}>
            No active signal — no stop needed yet. When a LONG or SHORT appears, this step
            will show your exact stop price before you size or enter the trade.
          </p>
        ) : (
          <>
            <p style={{ marginBottom: "8px" }}>
              {sig === 1 ? (
                <>
                  If {sym} drops to{" "}
                  <B color={C.red}>{fmt$(stopPrice)}</B>{" "}
                  ({stopPct.toFixed(1)}% below <N>{fmt$(price)}</N>), you&apos;re wrong.{" "}
                  <B color={C.red}>That is your exit price. Accept it now, before you buy.</B>
                </>
              ) : (
                <>
                  If {sym} rises to{" "}
                  <B color={C.red}>{fmt$(stopPrice)}</B>{" "}
                  ({stopPct.toFixed(1)}% above <N>{fmt$(price)}</N>), the short is wrong.{" "}
                  <B color={C.red}>That is your cover price. Accept it now, before you short.</B>
                </>
              )}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <div style={{ padding: "8px 10px",
                background: "rgba(196,30,58,0.07)", border: `1px solid ${C.red}55` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px" }}>Stop Price</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 800, color: C.red }}>
                  {fmt$(stopPrice)}
                </div>
                <div style={{ fontSize: "10px", color: C.muted }}>1.5× ATR · −{stopPct.toFixed(1)}% from entry</div>
              </div>
              <div style={{ padding: "8px 10px",
                background: "rgba(26,107,74,0.06)", border: `1px solid ${C.green}44` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px" }}>Target Price</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 800, color: C.green }}>
                  {fmt$(targetPrice)}
                </div>
                <div style={{ fontSize: "10px", color: C.muted }}>2.5:1 R:R · +{targetPct.toFixed(1)}% from entry</div>
              </div>
            </div>
            <p style={{ color: C.faint, fontSize: "11px" }}>
              ⚠ Set this stop in your broker <B>before</B> the fill confirms.
              A stop you haven&apos;t placed yet is not a stop — it&apos;s a wish.
            </p>
          </>
        )}
      </div>
    ),
  };

  // ── Filter pass/fail ─────────────────────────────────────────────────
  const kellyFail  = kelly === 0;
  const sharpeFail = sharpe < 0;
  const mcFail     = mc < 40;
  const flatFail   = sig === 0;
  const hardFail   = kellyFail || sharpeFail || mcFail || flatFail;
  const softWarn   = !hardFail && ((er < 0 && sig === 1) || conf < 0.6 || (regime.includes("trending_down") && sig === 1));

  const overallStatus: "go" | "caution" | "stop" =
    hardFail ? "stop" : softWarn ? "caution" : "go";

  const statusLabel =
    overallStatus === "go"      ? "✓ Good Setup — Here's Your Plan" :
    overallStatus === "caution" ? "⚠ Trade With Caution — Read the Steps" :
    "✕ Skip This Trade — Here's Why";
  const statusAccent =
    overallStatus === "go" ? C.green : overallStatus === "caution" ? C.amber : C.red;
  const statusBg =
    overallStatus === "go"      ? "rgba(26,107,74,0.07)"  :
    overallStatus === "caution" ? "rgba(139,105,20,0.08)" : "rgba(196,30,58,0.07)";

  // ── Step 2 — Filter ───────────────────────────────────────────────
  const filterChecks = [
    {
      label: "Kelly > 0%",
      pass:  !kellyFail,
      note:  kellyFail ? "Kelly = 0% → model says skip this trade entirely" : `Kelly = ${kelly}% → position size is viable`,
    },
    {
      label: "Sharpe ≥ 0",
      pass:  !sharpeFail,
      note:  sharpeFail ? `Sharpe = ${sharpe.toFixed(2)} → strategy has lost money risk-adjusted` : `Sharpe = ${sharpe.toFixed(2)} → acceptable risk/reward history`,
    },
    {
      label: "MC Prob ≥ 40%",
      pass:  !mcFail,
      note:  mcFail ? `MC = ${mc}% → less than 40% of simulated futures end profitably` : `MC = ${mc}% → odds are acceptable`,
    },
    {
      label: "Signal ≠ FLAT",
      pass:  !flatFail,
      note:  flatFail ? "Signal is FLAT — sub-models disagree on direction" : `Signal is ${sig === 1 ? "LONG" : "SHORT"} with ${(conf * 100).toFixed(0)}% confidence`,
    },
  ];

  const step1: Step = {
    num: 2, icon: <Zap className="h-3.5 w-3.5" />,
    title: "Quick sanity check — should you even trade this?",
    status: hardFail ? "stop" : softWarn ? "caution" : "go",
    body: (
      <div>
        <p style={{ marginBottom: "8px", color: C.muted }}>
          Four quick checks. If <B>any one fails</B>, the math says skip this trade.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {filterChecks.map(c => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: "8px",
              padding: "4px 8px",
              background: c.pass ? "rgba(26,107,74,0.06)" : "rgba(196,30,58,0.06)",
              border: `1px solid ${c.pass ? C.green : C.red}33` }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
                color: c.pass ? C.green : C.red, flexShrink: 0, width: "16px" }}>
                {c.pass ? "✓" : "✕"}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700,
                color: c.pass ? C.green : C.red, width: "110px", flexShrink: 0 }}>
                {c.label}
              </span>
              <span style={{ fontSize: "11px", color: C.muted }}>{c.note}</span>
            </div>
          ))}
        </div>
        {hardFail && (
          <div style={{ marginTop: "8px", padding: "7px 10px",
            background: "rgba(196,30,58,0.08)", border: "1px solid rgba(196,30,58,0.35)",
            fontWeight: 700, color: C.red, fontSize: "11px" }}>
            ✕ ONE OR MORE FILTERS FAILED — DO NOT TRADE {sym} RIGHT NOW
          </div>
        )}
      </div>
    ),
  };

  // ── Step 3 — Size ────────────────────────────────────────────────
  const step2: Step = {
    num: 3, icon: <Shield className="h-3.5 w-3.5" />,
    title: "How much to invest",
    status: kelly === 0 ? "stop" : kelly >= 5 ? "go" : "caution",
    body: (
      <div>
        <p style={{ marginBottom: "8px" }}>
          Your account: <B>{fmt$(accountSize)}</B>. Kelly says invest{" "}
          <B color={C.green}>{kelly}%</B> — that's{" "}
          <N color={C.green}>{fmt$(dollarAlloc)}</N> →{" "}
          <N color={C.green}>{shares} shares</N> of {sym} at <N>{fmt$(price)}</N>.
        </p>
        <p style={{ marginBottom: "6px", color: C.muted }}>
          <B>Never invest more than Kelly suggests.</B> The formula is mathematically designed
          to grow your account fastest without risking blowing it up. Bigger isn't smarter — it's just riskier.
        </p>
        {softWarn && (
          <p style={{ color: C.amber, fontWeight: 600, marginBottom: "6px" }}>
            ⚠ Caution detected — consider trading half-size ({fmt$(dollarAlloc / 2)}, ~{Math.floor(shares / 2)} shares)
            until the signal strengthens.
          </p>
        )}
        <div style={{ padding: "6px 10px",
          background: "rgba(196,30,58,0.06)", border: "1px solid rgba(196,30,58,0.25)",
          fontFamily: FONT_MONO, fontSize: "10px", color: C.muted }}>
          Max loss if stop (Step 1) is hit:{" "}
          <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$(maxLoss)}</span>
          {" "}({stopPct.toFixed(1)}% × {shares} shares × {fmt$(price)})
        </div>
      </div>
    ),
  };

  // ── Step 4 — Entry ───────────────────────────────────────────────
  const entryStatus: Step["status"] =
    sig === 0  ? "stop" :
    sig === 1 && regime.includes("trending_down") ? "caution" : "go";

  const step3: Step = {
    num: 4, icon: <Target className="h-3.5 w-3.5" />,
    title: sig === 1 ? "Enter — Buy" : sig === -1 ? "Enter — Short" : "No entry — wait",
    status: entryStatus,
    body: (
      <div>
        {sig === 0 ? (
          <p style={{ color: C.muted }}>
            The signal is <B color={C.amber}>FLAT</B> — sub-models disagree on direction.{" "}
            <B color={C.red}>Do not enter any trade.</B> Check back on the next refresh.
            A clear direction typically emerges within 1–4 trading sessions.
          </p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
              <div style={{ padding: "8px 10px",
                background: "rgba(26,107,74,0.07)", border: `1px solid ${C.green}44` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px" }}>Entry Price</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "16px", fontWeight: 800, color: C.text }}>
                  {fmt$(price)}
                </div>
                <div style={{ fontSize: "10px", color: C.muted }}>{shares} shares · {fmt$(actualDollar)}</div>
              </div>
              <div style={{ padding: "8px 10px",
                background: "rgba(26,107,74,0.05)", border: `1px solid ${C.green}33` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px" }}>Target Price</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "16px", fontWeight: 800, color: C.green }}>
                  {fmt$(targetPrice)}
                </div>
                <div style={{ fontSize: "10px", color: C.muted }}>+{targetPct.toFixed(1)}% · 2.5:1 R:R</div>
              </div>
            </div>
            <p style={{ color: C.muted }}>
              {sig === 1 ? (
                <>
                  Buy <B>{shares} shares</B> near <N>{fmt$(price)}</N>.
                  Your stop (<B color={C.red}>{fmt$(stopPrice)}</B>) is already set from Step 1 — confirm it
                  in your broker <B>before</B> this order fills.
                </>
              ) : (
                <>
                  Short <B>{shares} shares</B> near <N>{fmt$(price)}</N>.
                  Your buy-to-cover stop (<B color={C.red}>{fmt$(stopPrice)}</B>) is set from Step 1 — confirm it
                  in your broker <B>before</B> this order fills.
                </>
              )}
            </p>
            {regime.includes("volatile") && (
              <p style={{ color: C.amber, fontWeight: 600, marginTop: "6px" }}>
                ⚠ Volatile regime — expect large swings. Don't panic-exit on normal noise.
                Only exit if your stop price is actually hit.
              </p>
            )}
          </>
        )}
      </div>
    ),
  };

  // ── Step 5 — Monitor ────────────────────────────────────────────
  const monitorRows =
    sig === 0
      ? [
          { trigger: "Signal changes to LONG or SHORT", note: `Currently FLAT`, action: "Now you can look at entering. Set stop (Step 1), size (Step 3), then enter (Step 4)." },
          { trigger: "Kelly stays at 0%",               note: "Currently 0%",   action: "Do not enter. The model sees no edge. Wait." },
        ]
      : [
          { trigger: `Signal flips away from ${sig === 1 ? "LONG" : "SHORT"}`, note: `Currently ${sig === 1 ? "LONG" : "SHORT"}`, action: "EXIT immediately. The model changed its mind. Don't argue with it." },
          { trigger: "Confidence drops below 55%",      note: `Currently ${(conf * 100).toFixed(0)}%`, action: "Consider reducing to half position size. The models are disagreeing more." },
          { trigger: `RSI ${sig === 1 ? "crosses above 70" : "drops below 30"}`, note: `Currently ${rsi.toFixed(0)}`, action: sig === 1 ? "Overbought. Tighten your trailing stop loss upward." : "Oversold. Consider covering part of your short." },
          { trigger: "Kelly drops to 0%",               note: `Currently ${kelly}%`, action: "Exit the trade. The model no longer has statistical edge." },
          { trigger: `Price approaches stop (${fmt$(stopPrice)})`, note: "Step 1 stop level", action: "Do NOT move the stop down to avoid a loss. Let it hit. That is what it is for." },
        ];

  const step4: Step = {
    num: 5, icon: <Eye className="h-3.5 w-3.5" />,
    title: "While in the trade — what to watch",
    status: "info",
    body: (
      <div>
        <p style={{ marginBottom: "8px", color: C.muted }}>
          Check these on every data refresh:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {monitorRows.map((row, i) => (
            <div key={i} style={{ padding: "6px 10px",
              background: "rgba(11,31,58,0.04)", border: "1px solid rgba(11,31,58,0.12)",
              display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: "9px", fontWeight: 700,
                color: C.blue, background: "rgba(11,31,58,0.10)",
                padding: "1px 6px", flexShrink: 0, marginTop: "2px" }}>
                IF
              </span>
              <div>
                <span style={{ fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700, color: C.text }}>
                  {row.trigger}
                </span>{" "}
                <span style={{ fontSize: "10px", color: C.faint }}>({row.note})</span>
                <div style={{ fontSize: "11px", color: C.amber, fontWeight: 600, marginTop: "2px" }}>
                  → {row.action}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: "8px", color: C.faint, fontSize: "10px" }}>
          <B>Golden rule:</B> One bad minute is normal noise. Exit only when the signal changes or
          your stop is hit — not because of a single scary candle.
        </p>
      </div>
    ),
  };

  // ── Step 6 — Exit ───────────────────────────────────────────────
  const exitRows = sig === 0
    ? [
        { label: "Signal fires",         detail: "LONG or SHORT appears",    color: C.green, what: "Re-run the filter (Step 2). If it passes, set your stop (Step 1), size (Step 3), then enter (Step 4)." },
        { label: "15 min before close",  detail: "3:45 PM ET each day",      color: C.blue,  what: "Even if you didn't trade today, close any open positions. Never hold a day trade overnight." },
      ]
    : [
        { label: "Stop loss hit",        detail: fmt$(stopPrice),             color: C.red,   what: `Your broker auto-sells. Loss capped at ${fmt$(maxLoss)}. Do not override your stop — the small loss protects you from a catastrophic one.` },
        { label: "Target reached",       detail: fmt$(targetPrice),           color: C.green, what: `Sell ${Math.ceil(shares / 2)} shares (half your position) to lock in profit, then move your stop to your entry price ${fmt$(price)}. Let the other half run for more upside.` },
        { label: "Signal flips",         detail: "Model changes direction",   color: C.amber, what: "Exit 100% of your position immediately. The model has new information — respect it, even if it feels wrong in the moment." },
        { label: "15 min before close",  detail: "3:45 PM ET each day",      color: C.blue,  what: "Exit ALL positions by 3:45 PM ET. Holding overnight risks earnings, news, and global events gapping the stock against you while you sleep." },
      ];

  const step5: Step = {
    num: 6, icon: <LogOut className="h-3.5 w-3.5" />,
    title: "How and when to exit",
    status: "info",
    body: (
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {exitRows.map((row, i) => (
          <div key={i} style={{ padding: "7px 10px",
            background: `${row.color}08`, border: `1px solid ${row.color}33`,
            display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, minWidth: "90px" }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700, color: row.color }}>
                {row.label}
              </div>
              <div style={{ fontSize: "9px", color: C.faint, fontFamily: FONT_MONO }}>{row.detail}</div>
            </div>
            <div style={{ fontSize: "11px", color: C.muted, flex: 1 }}>{row.what}</div>
          </div>
        ))}
      </div>
    ),
  };

  const steps = [stopStep, step1, step2, step3, step4, step5];

  return (
    <div className="panel" style={{ overflow: "visible" }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
        style={{ background: statusBg, borderBottom: open ? `1px solid ${statusAccent}33` : "none" }}
        aria-expanded={open}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: "9px", fontWeight: 800,
            letterSpacing: "0.18em", color: statusAccent,
            border: `1px solid ${statusAccent}55`, padding: "2px 8px",
          }}>
            {statusLabel}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: "12px", fontWeight: 700, color: C.text, letterSpacing: "0.04em" }}>
            {sym} — Your Step-by-Step Trading Plan
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.muted }}>
            {open ? "Hide steps" : "Show steps"}
          </span>
          {open
            ? <ChevronUp  className="h-4 w-4 flex-shrink-0" style={{ color: C.faint }} />
            : <ChevronDown className="h-4 w-4 flex-shrink-0" style={{ color: C.faint }} />
          }
        </div>
      </button>

      {open && (
        <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Quick-stat bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", marginBottom: "4px" }}>
            {[
              { label: "Signal",     value: sig === 1 ? "LONG" : sig === -1 ? "SHORT" : "FLAT", color: sig === 1 ? C.green : sig === -1 ? C.red : C.amber },
              { label: "Confidence", value: `${(conf * 100).toFixed(0)}%`,  color: conf >= 0.75 ? C.green : conf >= 0.55 ? C.amber : C.red },
              { label: "Kelly",      value: `${kelly}%`,                     color: kelly > 0 ? C.green : C.red },
              { label: "Invest",     value: fmt$(actualDollar),              color: C.text },
              { label: "MC Prob",    value: `${mc}%`,                        color: mc >= 60 ? C.green : mc >= 45 ? C.amber : C.red },
            ].map(s => (
              <div key={s.label} style={{ padding: "6px 8px", background: "var(--bg-raised)",
                border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: C.faint,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>
                  {s.label}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800, color: s.color }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {steps.map(step => <StepCard key={step.num} step={step} />)}

          <p style={{
            fontFamily: FONT_BODY, fontSize: "10px", color: C.faint,
            textAlign: "center", lineHeight: 1.5, marginTop: "4px",
            borderTop: "1px solid var(--border)", paddingTop: "8px",
          }}>
            These are AI-generated trade ideas, not financial advice. Every trade can lose — that&apos;s why you always set a stop-loss before entering (Step 1). Stick to your plan, manage your risk, and never trade more than you can afford to lose. Suggested daily loss limit: −2% of your account.
          </p>
        </div>
      )}
    </div>
  );
}
