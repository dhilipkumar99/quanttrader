"use client";

/**
 * SimplifiedDashboard — The beginner entry point.
 *
 * One panel. One pick. One dollar amount. One reason. One button.
 * No Sharpe ratios. No Kelly fractions. No jargon.
 *
 * Design rule: if a person who has never traded cannot read this and know
 * exactly what to do in under 10 seconds, it is too complex.
 */

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle, ChevronRight, Copy, CheckCircle, Shield, X, Bot, Clock } from "lucide-react";
import { api, type DayTradePick, type DayTradePicksResult, ComputingError } from "@/lib/api";
import { useTrader } from "@/store/trader";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

const C = {
  green:  "#1A6B4A",
  red:    "#C41E3A",
  amber:  "#8B6914",
  navy:   "#0B1F3A",
  text:   "#1A1A1A",
  muted:  "#5A5248",
  faint:  "#8A8078",
  border: "rgba(155,146,128,0.2)",
};

// ── Guardrail: is this pick safe for a beginner? ────────────────────────────

function isBeginnerSafe(pick: DayTradePick): { safe: boolean; reason: string } {
  // max_drawdown is a positive fraction from the engine (e.g. 0.25 = 25% peak-to-trough loss)
  if (pick.max_drawdown > 0.25) {
    return { safe: false, reason: `Historical max drawdown is ${(pick.max_drawdown * 100).toFixed(0)}% — too volatile for beginners` };
  }
  if (pick.sharpe < 0.4) {
    return { safe: false, reason: "Risk-adjusted return history is below the threshold recommended for beginners" };
  }
  if (pick.confidence < 0.55) {
    return { safe: false, reason: `Signal confidence is only ${Math.round(pick.confidence * 100)}% — below the 55% beginner minimum` };
  }
  return { safe: true, reason: "" };
}

// ── Plain-English reason (no jargon) ────────────────────────────────────────

function toPlainReason(pick: DayTradePick): string {
  const dir = pick.direction === "long" ? "bullish" : "bearish";
  const sigs = pick.sub_signals ?? [];

  // Identify which sub-signals fired and translate them
  const fired = sigs.filter(s => (pick.direction === "long" ? s.direction === 1 : s.direction === -1));
  const labels: string[] = fired.slice(0, 2).map(s => {
    const n = s.source.toLowerCase();
    if (n.includes("rsi"))  return pick.direction === "long" ? "price is oversold and likely to bounce" : "price is overbought and likely to fall";
    if (n.includes("macd")) return "momentum just turned " + dir;
    if (n.includes("ema") || n.includes("trend")) return "short-term trend is " + dir;
    if (n.includes("vol"))  return "volume is unusually high — big players are moving";
    if (n.includes("regime")) return "market conditions favor " + dir + " trades right now";
    if (n.includes("hurst")) return "price has been trending consistently";
    if (n.includes("monte")) return "probability of a positive outcome is above average";
    return dir + " signal from the model";
  });

  if (labels.length === 0) return `The model sees a ${dir} setup with ${Math.round(pick.confidence * 100)}% confidence.`;
  if (labels.length === 1) return `${labels[0].charAt(0).toUpperCase() + labels[0].slice(1)}.`;
  return `${labels[0].charAt(0).toUpperCase() + labels[0].slice(1)}, and ${labels[1]}.`;
}

// ── Dollar amount helpers ────────────────────────────────────────────────────

function positionDollars(pick: DayTradePick, accountSize: number): number {
  return Math.round(accountSize * (pick.position_size_pct / 100));
}

function stopPrice(pick: DayTradePick): number {
  const atr = pick.atr_pct > 0.5 ? pick.atr_pct : pick.atr_pct * 100;
  const stopPct = Math.min(Math.max(atr * 1.5, 1.5), 8) / 100;
  return pick.direction === "long"
    ? pick.price * (1 - stopPct)
    : pick.price * (1 + stopPct);
}

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Clipboard copy with tick feedback ────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "14px 28px",
        background: copied ? "rgba(26,107,74,0.12)" : C.navy,
        color: copied ? C.green : "#FFFFFF",
        border: `2px solid ${copied ? C.green : C.navy}`,
        fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
        letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", transition: "all 0.2s",
        width: "100%", justifyContent: "center",
      }}
    >
      {copied
        ? <><CheckCircle size={16} /> Copied to clipboard</>
        : <><Copy size={16} /> {label}</>
      }
    </button>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────

function PickCard({
  pick,
  accountSize,
  onShowMore,
}: {
  pick: DayTradePick;
  accountSize: number;
  onShowMore: (sym: string) => void;
}) {
  const { safe, reason: guardReason } = isBeginnerSafe(pick);
  const dollars   = positionDollars(pick, accountSize);
  const stop      = stopPrice(pick);
  const stopPct   = Math.abs(pick.price - stop) / pick.price * 100;
  const maxLoss   = Math.round(dollars * stopPct / 100);
  const plainWhy  = toPlainReason(pick);
  const isLong    = pick.direction === "long";

  const brokerText =
    `${isLong ? "BUY" : "SELL SHORT"} ${pick.symbol} — ${fmt$(dollars)} position\n` +
    `Stop loss: ${fmt$(stop)}\n` +
    `Entry: market order\n` +
    `Reason: ${plainWhy}`;

  return (
    <div style={{
      border: `2px solid ${isLong ? "rgba(26,107,74,0.5)" : "rgba(196,30,58,0.5)"}`,
      background: isLong ? "rgba(26,107,74,0.04)" : "rgba(196,30,58,0.04)",
      padding: "28px",
    }}>

      {/* Direction chip + symbol */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "4px 12px", marginBottom: "10px",
            background: isLong ? "rgba(26,107,74,0.15)" : "rgba(196,30,58,0.12)",
            border: `1px solid ${isLong ? C.green : C.red}44`,
          }}>
            {isLong
              ? <TrendingUp size={14} style={{ color: C.green }} />
              : <TrendingDown size={14} style={{ color: C.red }} />
            }
            <span style={{
              fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 800,
              color: isLong ? C.green : C.red, letterSpacing: "0.12em", textTransform: "uppercase",
            }}>
              {isLong ? "Buy opportunity" : "Short opportunity"}
            </span>
          </div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "38px", fontWeight: 900,
            color: C.text, letterSpacing: "0.02em", lineHeight: 1,
          }}>
            {pick.symbol}
          </div>
          <div style={{
            fontFamily: FONT_BODY, fontSize: "15px", color: C.muted, marginTop: "4px",
          }}>
            {fmt$(pick.price)}
            <span style={{ marginLeft: "8px", color: pick.change_pct >= 0 ? C.green : C.red, fontWeight: 600 }}>
              {pick.change_pct >= 0 ? "+" : ""}{pick.change_pct.toFixed(2)}% today
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
            color: C.faint, textTransform: "uppercase", marginBottom: "2px",
          }}>
            Model confidence
          </div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "28px", fontWeight: 900,
            color: pick.confidence >= 0.70 ? C.green : pick.confidence >= 0.55 ? C.amber : C.red,
          }}>
            {Math.round(pick.confidence * 100)}%
          </div>
        </div>
      </div>

      {/* The single reason */}
      <div style={{
        padding: "16px 20px", marginBottom: "20px",
        background: "rgba(255,255,255,0.6)",
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${isLong ? C.green : C.red}`,
      }}>
        <div style={{
          fontFamily: FONT_MONO, fontSize: "9px", fontWeight: 700, letterSpacing: "0.15em",
          textTransform: "uppercase", color: C.faint, marginBottom: "6px",
        }}>
          Why the model is recommending this
        </div>
        <div style={{
          fontFamily: FONT_BODY, fontSize: "16px", lineHeight: 1.65, color: C.text, fontWeight: 600,
        }}>
          {plainWhy}
        </div>
      </div>

      {/* Three numbers: position, stop, max loss */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "rgba(255,255,255,0.7)", border: `1px solid ${C.border}` }}>
          <div style={{
            fontFamily: FONT_BODY, fontSize: "10px", color: C.faint,
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px",
          }}>
            Put in
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900, color: C.text }}>
            {fmt$(dollars)}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.muted, marginTop: "3px" }}>
            {pick.position_size_pct.toFixed(1)}% of your account
          </div>
        </div>
        <div style={{ padding: "16px", background: "rgba(196,30,58,0.04)", border: `1px solid rgba(196,30,58,0.2)` }}>
          <div style={{
            fontFamily: FONT_BODY, fontSize: "10px", color: C.red,
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px",
          }}>
            Set stop loss at
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900, color: C.red }}>
            {fmt$(stop)}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.muted, marginTop: "3px" }}>
            {stopPct.toFixed(1)}% {isLong ? "below" : "above"} entry
          </div>
        </div>
        <div style={{ padding: "16px", background: "rgba(196,30,58,0.04)", border: `1px solid rgba(196,30,58,0.2)` }}>
          <div style={{
            fontFamily: FONT_BODY, fontSize: "10px", color: C.red,
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px",
          }}>
            Max you could lose
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900, color: C.red }}>
            −{fmt$(maxLoss)}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: C.muted, marginTop: "3px" }}>
            if stop is hit
          </div>
        </div>
      </div>

      {/* Beginner guardrail banner */}
      {!safe && (
        <div style={{
          display: "flex", gap: "10px", padding: "12px 16px", marginBottom: "16px",
          background: "rgba(139,105,20,0.08)", border: "1px solid rgba(139,105,20,0.4)",
        }}>
          <AlertTriangle size={16} style={{ color: C.amber, flexShrink: 0, marginTop: "1px" }} />
          <div>
            <div style={{
              fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800,
              color: C.amber, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px",
            }}>
              Not recommended for beginners
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "#6B5010", lineHeight: 1.5 }}>
              {guardReason}
            </div>
          </div>
        </div>
      )}

      {/* CTA */}
      {safe ? (
        <CopyButton
          text={brokerText}
          label={`Copy ${isLong ? "buy" : "short sell"} order details`}
        />
      ) : (
        <button
          disabled
          style={{
            width: "100%", padding: "14px 28px",
            background: "rgba(155,146,128,0.1)",
            color: C.faint, border: "2px solid rgba(155,146,128,0.25)",
            fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 800,
            letterSpacing: "0.06em", textTransform: "uppercase",
            cursor: "not-allowed",
          }}
        >
          Signal below beginner threshold
        </button>
      )}

      <div style={{
        display: "flex", justifyContent: "center", marginTop: "14px",
      }}>
        <button
          onClick={() => onShowMore(pick.symbol)}
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontFamily: FONT_BODY, fontSize: "12px", color: C.faint,
            background: "none", border: "none", cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          See full analysis for {pick.symbol} <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Step-by-step instructions (shown below pick) ─────────────────────────────

function HowToAct({ pick, accountSize }: { pick: DayTradePick; accountSize: number }) {
  const dollars  = positionDollars(pick, accountSize);
  const stop     = stopPrice(pick);
  const isLong   = pick.direction === "long";
  const steps = [
    {
      n: "1",
      title: "Open your broker app",
      body: "Robinhood, Fidelity, Schwab, TD Ameritrade — any of them work.",
    },
    {
      n: "2",
      title: isLong ? `Search for ${pick.symbol} and tap Buy` : `Search for ${pick.symbol} and tap Sell / Short`,
      body: `Enter the amount: ${fmt$(dollars)}. Choose "Market order" so it fills immediately.`,
    },
    {
      n: "3",
      title: `Set a stop loss at ${fmt$(stop)}`,
      body: `This is the most important step. A stop loss automatically sells your shares if the price drops to ${fmt$(stop)}, limiting your loss to roughly ${fmt$(Math.round(dollars * Math.abs(pick.price - stop) / pick.price / dollars * dollars))} before it can get worse.`,
    },
    {
      n: "4",
      title: "Wait and check back",
      body: "The model's suggested hold time is days to weeks for this type of signal. Do not panic-sell on a normal dip if your stop hasn't been hit.",
    },
  ];

  return (
    <div style={{
      marginTop: "24px", padding: "24px 28px",
      border: `1px solid ${C.border}`,
      background: "rgba(255,255,255,0.5)",
    }}>
      <div style={{
        fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800,
        letterSpacing: "0.15em", textTransform: "uppercase",
        color: C.faint, marginBottom: "18px",
      }}>
        What to do — step by step
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {steps.map(s => (
          <div key={s.n} style={{ display: "flex", gap: "14px" }}>
            <div style={{
              width: "26px", height: "26px", flexShrink: 0,
              background: C.navy, color: "#fff",
              fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {s.n}
            </div>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: "14px", fontWeight: 700, color: C.text, marginBottom: "3px" }}>
                {s.title}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Waiting / loading states ──────────────────────────────────────────────────

function LoadingState() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "16px", padding: "80px 0",
    }}>
      <RefreshCw size={28} className="animate-spin" style={{ color: C.faint }} />
      <div style={{ fontFamily: FONT_BODY, fontSize: "15px", color: C.muted }}>
        Scanning the market for today&apos;s best opportunity…
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.faint }}>
        This takes about 30 seconds on the first load.
      </div>
    </div>
  );
}

function NoPickState({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "16px", padding: "64px 0", textAlign: "center",
    }}>
      <Shield size={40} style={{ color: C.faint }} />
      <div style={{ fontFamily: FONT_BODY, fontSize: "17px", fontWeight: 700, color: C.muted }}>
        No strong signals today
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: "13px", color: C.faint, maxWidth: "380px", lineHeight: 1.7 }}>
        The model did not find a setup that meets the beginner safety threshold right now.
        This is a good thing — it means the system is being selective.
        Check back after the market opens or try again in an hour.
      </div>
      <button
        onClick={onRetry}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "10px 20px", fontFamily: FONT_BODY, fontSize: "13px",
          background: "none", border: `1px solid ${C.border}`,
          color: C.muted, cursor: "pointer",
        }}
      >
        <RefreshCw size={13} /> Check again
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  onShowFullAnalysis: (sym: string) => void;
}

// ── Tutorial overlay (first session only) ────────────────────────────────────

function TutorialOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "Here's today's top opportunity",
      body: "The system has scanned hundreds of stocks and surfaced the one setup that passes every safety check. One recommendation — clear and actionable.",
    },
    {
      title: "Here's exactly what to invest and where to set your stop",
      body: "Below the recommendation you'll see three numbers: how much to put in, where to set your stop loss, and the maximum you could lose. Read all three before you act.",
    },
    {
      title: "Want us to track this automatically?",
      body: "The Agent can monitor your watchlist and alert you by email when a signal fires — without you having to check in. Set it up in the Agent tab when you're ready.",
    },
  ];
  const current = steps[step];
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(11,31,58,0.75)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        width: "100%", maxWidth: "440px",
        background: "var(--bg-card)", border: "2px solid var(--blue)",
        padding: "32px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ display: "flex", gap: "6px" }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                width: i === step ? "24px" : "8px", height: "8px",
                background: i <= step ? "var(--blue)" : "var(--border)",
                transition: "all 0.3s",
              }} />
            ))}
          </div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{
          fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800,
          letterSpacing: "0.15em", textTransform: "uppercase",
          color: "var(--blue)", marginBottom: "10px",
        }}>
          Step {step + 1} of {steps.length}
        </div>
        <div style={{
          fontFamily: "'Times New Roman', Times, Georgia, serif",
          fontSize: "20px", fontWeight: 700,
          color: "var(--text-primary)", marginBottom: "12px", lineHeight: 1.3,
        }}>
          {current.title}
        </div>
        <div style={{
          fontFamily: FONT_BODY, fontSize: "14px", lineHeight: 1.7,
          color: "var(--text-secondary)", marginBottom: "28px",
        }}>
          {current.body}
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)",
              background: "none", border: "none", cursor: "pointer", padding: "10px 0",
            }}>
              ← Back
            </button>
          )}
          <button
            onClick={() => { if (step < steps.length - 1) setStep(s => s + 1); else onDismiss(); }}
            style={{
              flex: 1, padding: "12px 24px",
              background: "var(--blue)", color: "#fff",
              border: "none", cursor: "pointer",
              fontFamily: FONT_BODY, fontSize: "13px", fontWeight: 600,
            }}
          >
            {step < steps.length - 1 ? "Next →" : "Got it, show me the picks"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent status card (shown when agent is running) ───────────────────────────

function AgentStatusCard() {
  const [status, setStatus] = useState<{
    running: boolean; enabled: boolean; last_run_ts: string;
    last_run_summary: string; dry_run: boolean;
  } | null>(null);

  useEffect(() => {
    api.agent.getStatus().then(setStatus).catch(() => {});
    const id = setInterval(() => api.agent.getStatus().then(setStatus).catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!status?.enabled) return null;

  const lastRun = status.last_run_ts
    ? new Date(status.last_run_ts.replace(" UTC", "Z")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 16px", marginBottom: "20px",
      background: "rgba(26,107,74,0.06)",
      border: "1px solid rgba(26,107,74,0.3)",
    }}>
      <Bot size={18} style={{ color: "#1A6B4A", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: "#1A6B4A", marginBottom: "2px",
        }}>
          Agent is running {status.dry_run ? "(paper mode)" : "(live)"}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.muted }}>
          {status.last_run_summary || "Monitoring your watchlist for signals"}
        </div>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: "5px",
        fontFamily: FONT_MONO, fontSize: "10px", color: C.faint,
      }}>
        <Clock size={11} />
        {lastRun}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SimplifiedDashboard({ onShowFullAnalysis }: Props) {
  const { onboarding, setTutorialSeen } = useTrader();
  const accountSize = onboarding.accountSize ?? 10_000;
  const showTutorial = !onboarding.tutorialSeen;

  const [pick,    setPick]    = useState<DayTradePick | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use server-side beginner filtering — only safe, high-confidence, long setups
      const result = await api.dayTradePicks(10, "swing", "sp500", false, true) as DayTradePicksResult;
      const safePick = result.picks[0] ?? null;
      setPick(safePick);
    } catch (e) {
      if (e instanceof ComputingError) {
        setRetryIn(e.retryAfter ?? 30);
        setError("computing");
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-retry when server is still computing
  useEffect(() => {
    if (error !== "computing" || retryIn <= 0) return;
    const t = setTimeout(load, retryIn * 1000);
    return () => clearTimeout(t);
  }, [error, retryIn, load]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "24px 0" }}>

      {/* Tutorial overlay — first session only */}
      {showTutorial && (
        <TutorialOverlay onDismiss={() => setTutorialSeen(true)} />
      )}

      {/* Agent status — shown when agent is enabled */}
      <AgentStatusCard />

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{
          fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800,
          letterSpacing: "0.2em", textTransform: "uppercase",
          color: C.faint, marginBottom: "6px",
        }}>
          Today&apos;s best opportunity
        </div>
        <h1 style={{
          fontFamily: FONT_BODY, fontSize: "26px", fontWeight: 700,
          color: C.text, margin: 0, lineHeight: 1.2,
        }}>
          The model found one setup for you today.
        </h1>
        <p style={{
          fontFamily: FONT_BODY, fontSize: "13px", color: C.muted,
          marginTop: "8px", lineHeight: 1.7,
        }}>
          Only opportunities that pass every safety check are shown here.
          You decide whether to act — the model just tells you what it sees.
        </p>
      </div>

      {/* Content */}
      {loading && <LoadingState />}

      {!loading && error === "computing" && (
        <div style={{ display: "flex", gap: "10px", padding: "16px 20px",
          background: "rgba(139,105,20,0.06)", border: "1px solid rgba(139,105,20,0.3)" }}>
          <RefreshCw size={14} className="animate-spin" style={{ color: C.amber, flexShrink: 0, marginTop: "2px" }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "#6B5010", lineHeight: 1.6 }}>
            The system is loading market data. Checking again in {retryIn}s…
          </div>
        </div>
      )}

      {!loading && error && error !== "computing" && (
        <div style={{ display: "flex", gap: "10px", padding: "16px 20px",
          background: "rgba(196,30,58,0.06)", border: "1px solid rgba(196,30,58,0.3)" }}>
          <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0, marginTop: "2px" }} />
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "13px", color: C.red }}>{error}</div>
            <button onClick={load} style={{
              fontFamily: FONT_BODY, fontSize: "12px", color: C.red,
              background: "none", border: "none", cursor: "pointer",
              textDecoration: "underline", padding: 0, marginTop: "6px",
            }}>Try again</button>
          </div>
        </div>
      )}

      {!loading && !error && !pick && <NoPickState onRetry={load} />}

      {!loading && !error && pick && (
        <>
          <PickCard pick={pick} accountSize={accountSize} onShowMore={onShowFullAnalysis} />
          <HowToAct pick={pick} accountSize={accountSize} />
        </>
      )}

      {/* Agent CTA footer */}
      <div style={{
        marginTop: "24px", padding: "16px 20px",
        background: "rgba(11,31,58,0.04)",
        border: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: "14px",
      }}>
        <Bot size={20} style={{ color: C.navy, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: "13px", fontWeight: 600, color: C.text, marginBottom: "2px" }}>
            Want the agent to do this automatically?
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: C.muted }}>
            Set up the Agent and it will monitor your watchlist and alert you by email every time a signal like this fires.
          </div>
        </div>
        <ChevronRight size={16} style={{ color: C.faint, flexShrink: 0 }} />
      </div>

      {/* Footer disclaimer */}
      <div style={{
        marginTop: "12px", padding: "12px 16px",
        background: "rgba(155,146,128,0.05)", border: `1px solid ${C.border}`,
        fontFamily: FONT_BODY, fontSize: "11px", color: C.faint, lineHeight: 1.6,
      }}>
        This is not financial advice. The model&apos;s past accuracy does not guarantee future results.
        Never invest money you cannot afford to lose. Always use a stop loss.
      </div>
    </div>
  );
}
