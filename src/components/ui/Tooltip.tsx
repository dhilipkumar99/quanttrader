"use client";

import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children?: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const positionClass = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left:   "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right:  "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[side];

  return (
    <div
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children ?? (
        <HelpCircle className="h-3 w-3 cursor-help transition-colors"
          style={{ color: "var(--text-disabled)" }} />
      )}
      {visible && (
        <div
          role="tooltip"
          className={cn("absolute z-50 w-52 text-xs leading-relaxed px-2.5 py-2 pointer-events-none", positionClass)}
          style={{
            background: "var(--bg-active)",
            border: "1px solid var(--border-strong)",
            borderRadius: "3px",
            color: "var(--text-secondary)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export function InfoTooltip({ content, className }: { content: string; className?: string }) {
  return <Tooltip content={content} className={className} />;
}

// ── MetricExplainer ────────────────────────────────────────────────────────────
// Rich hover panel that explains a metric in plain English — for beginners.
// Shows: metric name, ELI15 explanation, what the current value means, action.

export interface MetricExplainerProps {
  /** Short label shown in the UI, e.g. "RSI (14)" */
  label: string;
  /** Current numeric or string value, e.g. 53 */
  value: string | number;
  /** ELI15 paragraph — what this metric measures in plain English */
  what: string;
  /** Dynamic sentence about the current value for THIS stock right now */
  now: string;
  /** One-sentence action directive for a beginner */
  action: string;
  /** Traffic-light color: "green" | "yellow" | "red" | "blue" | "neutral" */
  status: "green" | "yellow" | "red" | "blue" | "neutral";
  children: React.ReactNode;
  /** Extra width if content is long */
  wide?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  green:   "#1A6B4A",
  yellow:  "#B8860B",
  red:     "#C41E3A",
  blue:    "#1E3A8A",
  neutral: "#555",
};

const STATUS_BG: Record<string, string> = {
  green:   "rgba(26,107,74,0.10)",
  yellow:  "rgba(184,134,11,0.10)",
  red:     "rgba(196,30,58,0.10)",
  blue:    "rgba(30,58,138,0.10)",
  neutral: "rgba(80,80,80,0.08)",
};

const STATUS_LABEL: Record<string, string> = {
  green:   "✓ Good signal",
  yellow:  "⚠ Caution",
  red:     "✕ Warning",
  blue:    "ℹ Neutral",
  neutral: "— No edge",
};

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

export function MetricExplainer({
  label, value, what, now, action, status, children, wide = false,
}: MetricExplainerProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelW = wide ? 340 : 280;

  const show = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    let top  = rect.bottom + 8;
    // Clamp right edge
    if (left + panelW > vw - 12) left = vw - panelW - 12;
    // If below fold, show above
    if (top + 220 > vh) top = rect.top - 230;
    setPos({ top, left });
    setVisible(true);
  };

  const hide = () => setVisible(false);

  // Close on scroll / resize
  useEffect(() => {
    if (!visible) return;
    const close = () => setVisible(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [visible]);

  const c = STATUS_COLOR[status];
  const bg = STATUS_BG[status];

  return (
    <>
      <div
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: "inline-flex", alignItems: "center", cursor: "help" }}
      >
        {children}
      </div>

      {visible && pos && (
        <div
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: "fixed",
            top:  pos.top,
            left: pos.left,
            width: panelW,
            zIndex: 9999,
            background: "#0B1F3A",
            border: `1px solid ${c}55`,
            boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${c}22`,
            pointerEvents: "auto",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "8px 12px 6px",
            background: bg,
            borderBottom: `1px solid ${c}33`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: "11px", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase", color: "#FFFFFF" }}>
              {label}
            </span>
            <span style={{
              fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 700, color: c,
            }}>
              {value}
            </span>
          </div>

          {/* Status badge */}
          <div style={{ padding: "5px 12px", borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
            <span style={{
              fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", color: c,
            }}>
              {STATUS_LABEL[status]}
            </span>
          </div>

          {/* What is this? */}
          <div style={{ padding: "8px 12px 6px" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.16em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>
              What is this?
            </div>
            <p style={{ fontFamily: FONT_BODY, fontSize: "11px", lineHeight: 1.6,
              color: "rgba(255,255,255,0.65)", margin: 0 }}>
              {what}
            </p>
          </div>

          {/* Right now */}
          <div style={{
            padding: "6px 12px",
            background: bg,
            borderTop: `1px solid ${c}22`,
            borderBottom: `1px solid ${c}22`,
          }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.16em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>
              Right now
            </div>
            <p style={{ fontFamily: FONT_BODY, fontSize: "11px", lineHeight: 1.5,
              color: "#FFFFFF", margin: 0, fontWeight: 500 }}>
              {now}
            </p>
          </div>

          {/* Action */}
          <div style={{ padding: "6px 12px 10px" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.16em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>
              What to do
            </div>
            <p style={{ fontFamily: FONT_BODY, fontSize: "11px", lineHeight: 1.5,
              color: c, margin: 0, fontWeight: 600 }}>
              {action}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
