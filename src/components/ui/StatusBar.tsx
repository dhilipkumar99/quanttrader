"use client";
import { useEffect, useState } from "react";
import type { AnalysisResult } from "@/types/quant";
import { cn } from "@/lib/utils";
import { signalLabel } from "@/lib/utils";

interface Props {
  symbol: string;
  analysis: AnalysisResult | null;
}

export function StatusBar({ symbol, analysis }: Props) {
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="status-bar flex-shrink-0">
      {/* Symbol — white, monospace */}
      <span style={{
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontWeight: 700,
        color: "#FFFFFF",
        fontSize: "11px",
      }}>
        {symbol}
      </span>

      {analysis && (
        <>
          <span className="num" style={{ color: "rgba(255,255,255,0.8)" }}>
            ${(analysis.price ?? 0).toFixed(2)}
          </span>
          <span className={cn("num", (analysis.change_pct ?? 0) >= 0 ? "up" : "down")}>
            {(analysis.change_pct ?? 0) >= 0 ? "+" : ""}{(analysis.change_pct ?? 0).toFixed(2)}%
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Signal:{" "}
            <span className={cn(
              "num",
              analysis.composite_signal === 1 ? "up" : analysis.composite_signal === -1 ? "down" : "flat"
            )} style={{ fontWeight: 600 }}>
              {signalLabel(analysis.composite_signal)}
            </span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Regime: <span style={{ color: "rgba(255,255,255,0.75)" }}>
              {(analysis.regime ?? "").replace(/_/g, " ")}
            </span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Kelly: <span className="num" style={{ color: "rgba(255,255,255,0.75)" }}>
              {analysis.position_size_pct ?? "—"}%
            </span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Sharpe: <span className="num" style={{ color: "rgba(255,255,255,0.75)" }}>
              {(analysis.risk_metrics?.sharpe ?? 0).toFixed(2)}
            </span>
          </span>
        </>
      )}

      {/* Time — right-aligned, muted white, monospace */}
      <span className="ml-auto num" style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px" }}>
        {time}
      </span>
    </footer>
  );
}
