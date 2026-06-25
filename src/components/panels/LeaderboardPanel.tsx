"use client";

import { useState, useEffect } from "react";
import { api, type LeaderboardRow, type LeaderboardResult } from "@/lib/api";
import { RefreshCw, TrendingUp, Trophy } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type Horizon = "day" | "swing" | "month";

function WinRateBar({ pct }: { pct: number }) {
  const color = pct >= 65 ? "#1A6B4A" : pct >= 50 ? "#8B6914" : "#C41E3A";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{
        flex: 1, height: "6px", background: "var(--bg-raised)",
        border: "1px solid var(--border)", overflow: "hidden",
      }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700, color, minWidth: "36px" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

interface Props {
  onSelectSymbol?: (sym: string) => void;
}

export function LeaderboardPanel({ onSelectSymbol }: Props) {
  const [horizon, setHorizon] = useState<Horizon>("swing");
  const [data, setData]       = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (attempt = 0) => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const d = await api.leaderboard(horizon);
        if (!cancelled) { setData(d); setLoading(false); }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = String(e);
        // 503 = still computing during server warm-up — retry up to 4 times
        if (msg.includes("503") || msg.includes("computing")) {
          if (attempt < 4) {
            const delay = (attempt + 1) * 15_000; // 15s, 30s, 45s, 60s
            retryTimer = setTimeout(() => load(attempt + 1), delay);
            // Show a gentle "warming up" message instead of an error
            setError(`warming_up:${attempt}`);
            setLoading(false);
          } else {
            setError("Server is still warming up. Refresh in a minute.");
            setLoading(false);
          }
        } else {
          setError(msg);
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [horizon]);

  return (
    <div className="panel">
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Trophy size={14} style={{ color: "#8B6914" }} />
          <span>Signal Leaderboard</span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {(["day", "swing", "month"] as Horizon[]).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              style={{
                padding: "2px 10px", fontSize: "9px", fontWeight: 700,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                background: horizon === h ? "var(--blue)" : "var(--bg-raised)",
                color: horizon === h ? "#fff" : "var(--text-muted)",
                border: `1px solid ${horizon === h ? "var(--blue)" : "var(--border)"}`,
                fontFamily: FONT_BODY,
              }}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 0" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", padding: "40px 0", color: "var(--text-muted)", fontFamily: FONT_BODY, fontSize: "13px" }}>
            <RefreshCw size={14} className="animate-spin" /> Computing signal accuracy across 20 symbols…
          </div>
        )}

        {error && !error.startsWith("warming_up") && (
          <div style={{ padding: "16px", color: "var(--red)", fontFamily: FONT_BODY, fontSize: "12px" }}>
            {error}
          </div>
        )}

        {error?.startsWith("warming_up") && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", padding: "40px 0", color: "var(--text-muted)", fontFamily: FONT_BODY, fontSize: "13px" }}>
            <RefreshCw size={14} className="animate-spin" /> Server warming up — retrying shortly…
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Summary strip */}
            <div style={{
              display: "flex", gap: "24px", padding: "8px 16px 16px",
              borderBottom: "1px solid var(--border)", marginBottom: "4px",
            }}>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>
                  Symbols scored
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>
                  {data.symbols_scored}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>
                  Best win rate
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 700, color: "#1A6B4A" }}>
                  {data.rows[0] ? `${data.rows[0].win_rate.toFixed(0)}% (${data.rows[0].symbol})` : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>
                  Horizon
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", textTransform: "capitalize" }}>
                  {data.horizon}
                </div>
              </div>
            </div>

            {/* Table */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["#", "Symbol", "Win Rate", "Avg Return", "Signals", "Wins / Losses"].map(h => (
                    <th key={h} style={{
                      padding: "6px 16px", textAlign: "left",
                      fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 700,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row: LeaderboardRow, i: number) => (
                  <tr
                    key={row.symbol}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: onSelectSymbol ? "pointer" : "default",
                      background: i === 0 ? "rgba(26,107,74,0.04)" : "transparent",
                      transition: "background 0.15s",
                    }}
                    onClick={() => onSelectSymbol?.(row.symbol)}
                    onMouseEnter={e => { if (i > 0) (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-raised)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = i === 0 ? "rgba(26,107,74,0.04)" : "transparent"; }}
                  >
                    <td style={{ padding: "8px 16px", fontFamily: FONT_MONO, fontSize: "10px", color: "var(--text-muted)" }}>
                      {i === 0 ? "🏆" : i + 1}
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {i < 3 && <TrendingUp size={10} style={{ color: "#1A6B4A" }} />}
                        <span style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
                          {row.symbol}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "8px 16px", minWidth: "140px" }}>
                      <WinRateBar pct={row.win_rate} />
                    </td>
                    <td style={{ padding: "8px 16px", fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 700,
                      color: row.avg_return >= 0 ? "#1A6B4A" : "#C41E3A" }}>
                      {row.avg_return >= 0 ? "+" : ""}{row.avg_return.toFixed(2)}%
                    </td>
                    <td style={{ padding: "8px 16px", fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-muted)" }}>
                      {row.signals}
                    </td>
                    <td style={{ padding: "8px 16px", fontFamily: FONT_MONO, fontSize: "11px" }}>
                      <span style={{ color: "#1A6B4A" }}>{row.wins}W</span>
                      <span style={{ color: "var(--text-disabled)", margin: "0 4px" }}>/</span>
                      <span style={{ color: "#C41E3A" }}>{row.losses}L</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ padding: "10px 16px", fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-disabled)", lineHeight: 1.5 }}>
              Win rate computed on 10-bar forward returns across the past 12 months. Past signal accuracy does not guarantee future results.
              Generated: {data.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
