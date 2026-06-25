"use client";

import { TrendingUp, TrendingDown, Minus, ChevronRight, OctagonX } from "lucide-react";
import type { AnalysisResult } from "@/types/quant";
import { SignalHistoryPanel } from "@/components/panels/SignalHistoryPanel";

const FONT_SERIF = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

interface Props {
  data: AnalysisResult;
  accountSize: number;
  period: string;
  onExpertMode: () => void;
}

function SignalBadge({ signal, confidence }: { signal: number; confidence: number }) {
  const conf = Math.round(confidence * 100);
  if (signal === 1) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
        padding: "28px 40px",
        background: "linear-gradient(135deg, rgba(26,107,74,0.25) 0%, rgba(26,107,74,0.08) 100%)",
        border: "2px solid rgba(26,107,74,0.6)",
      }}>
        <TrendingUp size={48} style={{ color: "var(--green)" }} strokeWidth={2} />
        <span style={{
          fontFamily: FONT_MONO, fontSize: "36px", fontWeight: 900,
          color: "var(--green)", letterSpacing: "0.05em",
        }}>BUY</span>
        <span style={{
          fontFamily: FONT_SERIF, fontSize: "15px", color: "rgba(26,107,74,0.85)",
        }}>
          {conf}% confidence
        </span>
      </div>
    );
  }
  if (signal === -1) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
        padding: "28px 40px",
        background: "linear-gradient(135deg, rgba(196,30,58,0.25) 0%, rgba(196,30,58,0.08) 100%)",
        border: "2px solid rgba(196,30,58,0.6)",
      }}>
        <TrendingDown size={48} style={{ color: "var(--red)" }} strokeWidth={2} />
        <span style={{
          fontFamily: FONT_MONO, fontSize: "36px", fontWeight: 900,
          color: "var(--red)", letterSpacing: "0.05em",
        }}>SELL</span>
        <span style={{
          fontFamily: FONT_SERIF, fontSize: "15px", color: "rgba(196,30,58,0.85)",
        }}>
          {conf}% confidence
        </span>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      padding: "28px 40px",
      background: "rgba(155,146,128,0.08)",
      border: "2px solid rgba(155,146,128,0.3)",
    }}>
      <Minus size={48} style={{ color: "var(--text-muted)" }} strokeWidth={2} />
      <span style={{
        fontFamily: FONT_MONO, fontSize: "36px", fontWeight: 900,
        color: "var(--text-muted)", letterSpacing: "0.05em",
      }}>HOLD</span>
      <span style={{
        fontFamily: FONT_SERIF, fontSize: "15px", color: "var(--text-muted)",
      }}>
        No clear signal
      </span>
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 75 ? "var(--green)" : pct >= 60 ? "#F59E0B" : "var(--red)";
  return (
    <div style={{ width: "100%" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", marginBottom: "6px",
        fontFamily: FONT_SERIF, fontSize: "12px", color: "var(--text-muted)",
      }}>
        <span>Signal Confidence</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{
        width: "100%", height: "10px",
        background: "var(--bg-raised)", border: "1px solid var(--border)",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: color,
          transition: "width 0.6s ease",
        }} />
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: "4px",
        fontFamily: FONT_SERIF, fontSize: "10px", color: "var(--text-disabled)",
      }}>
        <span>0%</span>
        <span>50% (coin flip)</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function StopLossCard({ signal, price, atrPct, accountSize, positionPct }: {
  signal: number; price: number; atrPct: number; accountSize: number; positionPct: number;
}) {
  if (signal === 0) return null;
  const stopPct   = Math.min(Math.max(atrPct * 1.5, 1.5), 8);
  const stopPrice = signal === 1 ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100);
  const dollars   = Math.round(accountSize * positionPct / 100);
  const maxLoss   = Math.round(dollars * stopPct / 100);

  return (
    <div style={{
      margin: "16px 0",
      padding: "16px 20px",
      background: "rgba(196,30,58,0.06)",
      border: "2px solid rgba(196,30,58,0.45)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px",
      }}>
        <OctagonX size={16} style={{ color: "#C41E3A", flexShrink: 0 }} />
        <span style={{
          fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 800, letterSpacing: "0.15em",
          color: "#C41E3A", textTransform: "uppercase",
        }}>
          Step 1 — Set your stop BEFORE you buy
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "10px" }}>
        <div>
          <div style={{
            fontFamily: FONT_SERIF, fontSize: "10px", color: "#8A8078",
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px",
          }}>Stop price</div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900, color: "#C41E3A",
          }}>
            ${stopPrice.toFixed(2)}
          </div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: "11px", color: "#5A5248", marginTop: "2px" }}>
            {stopPct.toFixed(1)}% {signal === 1 ? "below" : "above"} entry
          </div>
        </div>
        <div>
          <div style={{
            fontFamily: FONT_SERIF, fontSize: "10px", color: "#8A8078",
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "3px",
          }}>Max you could lose</div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900, color: "#C41E3A",
          }}>
            −${maxLoss.toLocaleString()}
          </div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: "11px", color: "#5A5248", marginTop: "2px" }}>
            if stop is hit on ${dollars.toLocaleString()} position
          </div>
        </div>
      </div>
      <p style={{
        fontFamily: FONT_SERIF, fontSize: "12px", color: "#5A5248", lineHeight: 1.6, margin: 0,
      }}>
        Enter <strong style={{ color: "#C41E3A" }}>${stopPrice.toFixed(2)}</strong> as your stop
        loss in your broker <em>before</em> placing the buy order.
        A stop you haven&apos;t placed yet is not a stop — it&apos;s a wish.
      </p>
    </div>
  );
}

function PositionSuggestion({ accountSize, positionPct, signal }: {
  accountSize: number; positionPct: number; signal: number;
}) {
  if (signal === 0 || positionPct === 0) return null;
  const dollars = Math.round(accountSize * positionPct / 100);
  return (
    <div style={{
      padding: "16px 20px",
      background: "var(--bg-raised)",
      border: "1px solid var(--border)",
    }}>
      <div style={{
        fontFamily: FONT_SERIF, fontSize: "11px", color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px",
      }}>
        Suggested Position Size
      </div>
      <div style={{
        fontFamily: FONT_MONO, fontSize: "28px", fontWeight: 900,
        color: "var(--text-primary)",
      }}>
        ${dollars.toLocaleString()}
      </div>
      <div style={{
        fontFamily: FONT_SERIF, fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px",
      }}>
        {positionPct.toFixed(1)}% of your ${accountSize.toLocaleString()} account · based on risk-adjusted Kelly formula
      </div>
    </div>
  );
}

export function BeginnerModeView({ data, accountSize, period, onExpertMode }: Props) {
  const atrRaw = data.indicators?.atr_pct ?? 0.02;
  const atrPct = atrRaw > 0.5 ? atrRaw : atrRaw * 100;

  const summary = data.beginner_summary || (
    data.composite_signal === 1
      ? `${data.symbol} is showing bullish signals with ${Math.round(data.composite_confidence * 100)}% confidence.`
      : data.composite_signal === -1
      ? `${data.symbol} is showing bearish signals with ${Math.round(data.composite_confidence * 100)}% confidence.`
      : `${data.symbol} has no clear signal right now. The model's sub-signals are mixed.`
  );

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "24px 0" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px",
      }}>
        <div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: "22px", fontWeight: 900,
            color: "var(--text-primary)",
          }}>
            {data.symbol}
          </div>
          <div style={{
            fontFamily: FONT_SERIF, fontSize: "13px", color: "var(--text-muted)", marginTop: "2px",
          }}>
            ${data.price.toFixed(2)}
            <span style={{
              marginLeft: "8px",
              color: data.change_pct >= 0 ? "var(--green)" : "var(--red)",
              fontWeight: 600,
            }}>
              {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% today
            </span>
          </div>
        </div>
        <button
          onClick={onExpertMode}
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontFamily: FONT_SERIF, fontSize: "11px", color: "var(--text-muted)",
            background: "none", border: "none", cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          See full analysis <ChevronRight size={12} />
        </button>
      </div>

      {/* Big signal badge */}
      <SignalBadge signal={data.composite_signal} confidence={data.composite_confidence} />

      {/* Stop loss — must be acknowledged before reading further */}
      <StopLossCard
        signal={data.composite_signal}
        price={data.price}
        atrPct={atrPct}
        accountSize={accountSize}
        positionPct={data.position_size_pct}
      />

      {/* Plain English summary */}
      <div style={{
        margin: "20px 0",
        padding: "18px 20px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${
          data.composite_signal === 1 ? "var(--green)" :
          data.composite_signal === -1 ? "var(--red)" :
          "var(--text-muted)"
        }`,
      }}>
        <div style={{
          fontFamily: FONT_SERIF, fontSize: "14px", lineHeight: 1.75,
          color: "var(--text-secondary)",
        }}>
          {summary}
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ marginBottom: "20px" }}>
        <ConfidenceBar confidence={data.composite_confidence} />
      </div>

      {/* Position suggestion */}
      <div style={{ marginBottom: "24px" }}>
        <PositionSuggestion
          accountSize={accountSize}
          positionPct={data.position_size_pct}
          signal={data.composite_signal}
        />
      </div>

      {/* Signal history — did it work? */}
      <div style={{ marginBottom: "16px" }}>
        <SignalHistoryPanel symbol={data.symbol} period={period} />
      </div>

      {/* Disclaimer */}
      <div style={{
        padding: "12px 16px",
        background: "rgba(155,146,128,0.06)",
        border: "1px solid rgba(155,146,128,0.2)",
        fontFamily: FONT_SERIF, fontSize: "11px", color: "var(--text-disabled)",
        lineHeight: 1.6,
      }}>
        This is a quantitative analysis tool, not financial advice. Past signal accuracy does
        not guarantee future results. Always use a stop loss and never risk more than you can
        afford to lose. For more detail, click &ldquo;See full analysis&rdquo; above.
      </div>
    </div>
  );
}
