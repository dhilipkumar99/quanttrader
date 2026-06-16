"use client";

import { useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, AlertCircle, BarChart2,
  ChevronDown, ChevronUp, Activity, Zap, Shield, Info,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  OptionsChain, OptionContract, OptionsSignalResult, ScanHorizon,
} from "@/lib/api";

const FONT_MONO = "'SF Mono', 'Fira Code', monospace";
const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt$(n: number, dp = 2) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function fmtPct(n: number, dp = 1) {
  return `${(n * 100).toFixed(dp)}%`;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ── IV Gauge ─────────────────────────────────────────────────────────────────

function IVGauge({ rank }: { rank: number }) {
  const r     = clamp(rank, 0, 100);
  const color = r < 30 ? "var(--green)" : r < 70 ? "var(--yellow)" : "var(--red)";
  const label = r < 30 ? "Cheap" : r < 70 ? "Fair" : "Expensive";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)" }}>IV Rank</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color, fontWeight: 700 }}>
          {r.toFixed(0)} — {label}
        </span>
      </div>
      <div style={{ height: 5, background: "var(--bg-raised)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%",
          width: `${r}%`, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ── Greeks row ───────────────────────────────────────────────────────────────

function GreeksRow({ c }: { c: OptionContract }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
      {[
        { label: "Δ Delta", val: c.delta.toFixed(3), color: Math.abs(c.delta) > 0.6 ? "var(--green)" : "var(--text-secondary)" },
        { label: "Γ Gamma", val: c.gamma.toFixed(5), color: "var(--text-secondary)" },
        { label: "Θ Theta", val: c.theta.toFixed(3), color: "var(--red)" },
        { label: "Vega",   val: c.vega.toFixed(3),  color: "var(--text-secondary)" },
      ].map(({ label, val, color }) => (
        <div key={label} style={{ background: "var(--bg-raised)", padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ── Contract card ─────────────────────────────────────────────────────────────

function ContractCard({
  contract, label, accent,
}: { contract: OptionContract; label: string; accent: string }) {
  return (
    <div style={{ border: `1px solid ${accent}44`, padding: "10px 12px", flex: 1 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
        textTransform: "uppercase", color: accent, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
          {fmt$(contract.strike)}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: "var(--text-secondary)" }}>
          {contract.expiry} · {contract.dte}d
        </span>
        <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: contract.itm ? accent : "var(--text-muted)" }}>
          {contract.itm ? "ITM" : "OTM"}
        </span>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
        bid {fmt$(contract.bid)} / ask {fmt$(contract.ask)} · mid {fmt$(contract.mid)}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
        Vol {contract.volume.toLocaleString()} · OI {contract.open_interest.toLocaleString()} · IV {fmtPct(contract.iv)}
      </div>
      <GreeksRow c={contract} />
    </div>
  );
}

// ── P&L summary ───────────────────────────────────────────────────────────────

function PnLSummary({ rec }: { rec: OptionsSignalResult["recommendation"] }) {
  if (!rec) return null;
  const isSpread = rec.strategy.includes("spread");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 12 }}>
      {[
        { label: "Max Profit", val: fmt$(rec.max_profit), color: "var(--green)" },
        { label: "Max Loss",   val: fmt$(rec.max_loss),   color: "var(--red)" },
        { label: "Breakeven",  val: fmt$(rec.breakeven),  color: "var(--text-secondary)" },
        { label: "P(Profit)",  val: `${rec.prob_profit.toFixed(0)}%`, color: rec.prob_profit > 50 ? "var(--green)" : "var(--yellow)" },
      ].map(({ label, val, color }) => (
        <div key={label} style={{ background: "var(--bg-raised)", padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ── Chain table ───────────────────────────────────────────────────────────────

function ChainTable({
  contracts,
  type,
  underlyingPrice,
}: { contracts: OptionContract[]; type: "call" | "put"; underlyingPrice: number }) {
  const [showAll, setShowAll] = useState(false);
  const accent = type === "call" ? "var(--green)" : "var(--red)";
  const label  = type === "call" ? "Calls" : "Puts";

  // Show OTM first (most commonly traded), nearest strikes to ATM
  const sorted = [...contracts]
    .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))
    .slice(0, showAll ? 50 : 12);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
        textTransform: "uppercase", color: accent, padding: "6px 0", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_MONO, fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Expiry","Strike","Bid","Ask","Mid","Vol","OI","IV","Δ","Θ","DTE"].map(h => (
                <th key={h} style={{ padding: "3px 6px", textAlign: "right",
                  color: "var(--text-muted)", fontWeight: 400, fontSize: 9, fontFamily: FONT_BODY,
                  letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => {
              const isATM = Math.abs(c.strike - underlyingPrice) < underlyingPrice * 0.01;
              return (
                <tr key={`${c.expiry}-${c.strike}`}
                  style={{
                    borderBottom: "1px solid var(--border)33",
                    background: isATM ? `${accent}11` : i % 2 === 0 ? "transparent" : "var(--bg-raised)33",
                  }}>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-muted)" }}>{c.expiry}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right",
                    color: isATM ? accent : c.itm ? "var(--text-secondary)" : "var(--text-primary)",
                    fontWeight: isATM ? 700 : 400 }}>
                    {fmt$(c.strike)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt$(c.bid)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt$(c.ask)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-primary)", fontWeight: 600 }}>{fmt$(c.mid)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: c.volume > 500 ? accent : "var(--text-muted)" }}>
                    {c.volume.toLocaleString()}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-muted)" }}>
                    {c.open_interest.toLocaleString()}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-secondary)" }}>
                    {fmtPct(c.iv)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right",
                    color: Math.abs(c.delta) > 0.5 ? accent : "var(--text-secondary)" }}>
                    {c.delta.toFixed(2)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--red)" }}>
                    {c.theta.toFixed(3)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-muted)" }}>{c.dte}d</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {contracts.length > 12 && (
        <button onClick={() => setShowAll(v => !v)}
          style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)",
            background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: "2px 0" }}>
          {showAll ? "Show less ↑" : `Show all ${contracts.length} contracts ↓`}
        </button>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = "signal" | "chain";

export function OptionsPanel({ symbol, horizon }: { symbol: string; horizon: ScanHorizon }) {
  const [tab, setTab]                 = useState<Tab>("signal");
  const [portfolioValue, setPortfolioValue] = useState(10_000);
  const [signalData, setSignalData]   = useState<OptionsSignalResult | null>(null);
  const [chainData, setChainData]     = useState<OptionsChain | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [expandChain, setExpandChain] = useState(false);

  const fetchSignal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.options.signal(symbol, horizon, portfolioValue);
      setSignalData(res);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to load options signal");
    } finally {
      setLoading(false);
    }
  }, [symbol, horizon, portfolioValue]);

  const fetchChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.options.chain(symbol);
      setChainData(res);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to load options chain");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const rec = signalData?.recommendation;
  const sigDir = signalData?.signal ?? 0;
  const accentColor = sigDir === 1 ? "var(--green)" : sigDir === -1 ? "var(--red)" : "var(--yellow)";

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "10px 14px", background: "var(--bg-raised)",
        borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart2 className="h-4 w-4" style={{ color: "var(--accent)" }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700,
            color: "var(--text-primary)" }}>
            Options — {symbol}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: "var(--text-muted)",
            background: "var(--bg-inset)", padding: "1px 6px", borderRadius: 2 }}>
            {horizon}
          </span>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 0 }}>
          {(["signal", "chain"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ fontFamily: FONT_BODY, fontSize: 10, padding: "4px 12px",
                background: tab === t ? "var(--accent)" : "var(--bg-inset)",
                color: tab === t ? "#fff" : "var(--text-muted)",
                border: "1px solid var(--border)", cursor: "pointer",
                fontWeight: tab === t ? 700 : 400, letterSpacing: "0.06em",
                textTransform: "uppercase" }}>
              {t === "signal" ? "Signal → Trade" : "Full Chain"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 14px" }}>

        {/* ── SIGNAL TAB ─────────────────────────────────────────────────── */}
        {tab === "signal" && (
          <>
            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
              flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-muted)" }}>
                  Portfolio $
                </span>
                <input
                  type="number"
                  value={portfolioValue}
                  onChange={e => setPortfolioValue(Math.max(100, Number(e.target.value)))}
                  style={{ fontFamily: FONT_MONO, fontSize: 11, width: 90,
                    background: "var(--bg-raised)", border: "1px solid var(--border)",
                    color: "var(--text-primary)", padding: "3px 6px" }}
                />
              </div>
              <button onClick={fetchSignal} disabled={loading}
                style={{ fontFamily: FONT_BODY, fontSize: 10, padding: "5px 14px",
                  background: "var(--accent)", color: "#fff", border: "none",
                  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {loading ? "Analysing…" : "Get Options Signal"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Info className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
                <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)" }}>
                  Risk budget: 1.5% of portfolio per trade
                </span>
              </div>
            </div>

            {error && (
              <div style={{ display: "flex", gap: 8, padding: "8px 10px",
                background: "var(--red-dim)", border: "1px solid var(--red)44", marginBottom: 12 }}>
                <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: "var(--red)" }} />
                <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: "var(--red)" }}>{error}</span>
              </div>
            )}

            {!signalData && !loading && !error && (
              <div style={{ padding: "24px 0", textAlign: "center" }}>
                <Zap className="h-6 w-6 mx-auto mb-2" style={{ color: "var(--text-disabled)" }} />
                <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-muted)" }}>
                  Click "Get Options Signal" to translate the quant engine's view of {symbol}
                  into a specific option trade — calls for long signals, puts for shorts.
                </p>
              </div>
            )}

            {signalData && (
              <>
                {/* Signal header */}
                <div style={{ padding: "10px 12px", background: `${accentColor}11`,
                  border: `1px solid ${accentColor}44`, marginBottom: 12,
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {sigDir === 1
                    ? <TrendingUp className="h-4 w-4" style={{ color: accentColor }} />
                    : sigDir === -1
                    ? <TrendingDown className="h-4 w-4" style={{ color: accentColor }} />
                    : <Activity className="h-4 w-4" style={{ color: accentColor }} />}
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: accentColor }}>
                    {sigDir === 1 ? "LONG signal → " : sigDir === -1 ? "SHORT signal → " : ""}
                    {rec?.strategy?.replace(/_/g, " ").toUpperCase() ?? "Neutral"}
                  </span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-secondary)" }}>
                    {(signalData.confidence * 100).toFixed(0)}% confidence · {signalData.regime ?? ""}
                  </span>
                  {signalData.iv_rank !== undefined && (
                    <div style={{ marginLeft: "auto", minWidth: 160 }}>
                      <IVGauge rank={signalData.iv_rank} />
                    </div>
                  )}
                </div>

                {signalData.message && !rec && (
                  <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-secondary)", padding: "8px 0" }}>
                    {signalData.message}
                  </p>
                )}

                {rec && (
                  <>
                    {/* Market context strip */}
                    {signalData.underlying_price && (
                      <div style={{ display: "flex", gap: 16, padding: "6px 0", marginBottom: 10,
                        flexWrap: "wrap" }}>
                        {[
                          { label: "Stock price",  val: fmt$(signalData.underlying_price) },
                          { label: "ATM IV",        val: `${signalData.atm_iv?.toFixed(0)}%` },
                          { label: "HV 30d",        val: `${signalData.hist_vol?.toFixed(0)}%` },
                          { label: "IV/HV ratio",   val: signalData.atm_iv && signalData.hist_vol
                            ? `${(signalData.atm_iv / signalData.hist_vol).toFixed(2)}×` : "—" },
                        ].map(({ label, val }) => (
                          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)",
                              textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
                            <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                              color: "var(--text-primary)" }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* IV environment badge */}
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px",
                      background: rec.iv_environment === "cheap" ? "var(--green-dim)"
                        : rec.iv_environment === "expensive" ? "var(--red-dim)" : "var(--yellow-dim)",
                      border: `1px solid ${rec.iv_environment === "cheap" ? "var(--green)" : rec.iv_environment === "expensive" ? "var(--red)" : "var(--yellow)"}44`,
                      marginBottom: 12 }}>
                      <Shield className="h-3 w-3" style={{ color: rec.iv_environment === "cheap" ? "var(--green)" : rec.iv_environment === "expensive" ? "var(--red)" : "var(--yellow)" }} />
                      <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700,
                        color: rec.iv_environment === "cheap" ? "var(--green)" : rec.iv_environment === "expensive" ? "var(--red)" : "var(--yellow)" }}>
                        {rec.iv_environment === "cheap"
                          ? "IV is cheap — good time to buy options"
                          : rec.iv_environment === "expensive"
                          ? `IV is elevated — ${rec.strategy.includes("spread") ? "using spread to reduce premium" : "consider spreads"}`
                          : "IV is fair — standard option sizing"}
                      </span>
                    </div>

                    {/* Contract cards */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                      {rec.contract && (
                        <ContractCard
                          contract={rec.contract}
                          label={rec.spread_short_leg ? "Buy leg" : rec.strategy.replace(/_/g, " ")}
                          accent={accentColor}
                        />
                      )}
                      {rec.spread_short_leg && (
                        <ContractCard
                          contract={rec.spread_short_leg}
                          label="Sell leg (spread)"
                          accent="var(--text-muted)"
                        />
                      )}
                    </div>

                    {/* P&L metrics */}
                    <PnLSummary rec={rec} />

                    {/* Sizing recommendation */}
                    {rec.recommended_qty > 0 && rec.contract && (
                      <div style={{ marginTop: 12, padding: "8px 12px",
                        background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: "var(--text-secondary)" }}>
                          Recommended size:{" "}
                          <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13,
                            color: "var(--text-primary)" }}>
                            {rec.recommended_qty} contract{rec.recommended_qty > 1 ? "s" : ""}
                          </span>
                          {" "}({100 * rec.recommended_qty} shares equiv.) ·{" "}
                          <span style={{ color: "var(--red)", fontFamily: FONT_MONO, fontWeight: 700 }}>
                            {fmt$(rec.max_loss)} premium at risk
                          </span>
                          {" "}(1.5% of portfolio)
                        </span>
                      </div>
                    )}

                    {/* Rationale */}
                    <div style={{ marginTop: 12, padding: "10px 12px",
                      background: "var(--bg-raised)", border: "1px solid var(--border)" }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                        textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
                        Why this trade
                      </div>
                      <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: "var(--text-secondary)",
                        lineHeight: 1.7, margin: 0 }}>
                        {rec.rationale}
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── CHAIN TAB ──────────────────────────────────────────────────── */}
        {tab === "chain" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <button onClick={fetchChain} disabled={loading}
                style={{ fontFamily: FONT_BODY, fontSize: 10, padding: "5px 14px",
                  background: "var(--accent)", color: "#fff", border: "none",
                  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {loading ? "Loading…" : "Load Chain"}
              </button>
              <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)" }}>
                Fetches live chain via yfinance · cached 5 min
              </span>
            </div>

            {error && (
              <div style={{ display: "flex", gap: 8, padding: "8px 10px",
                background: "var(--red-dim)", border: "1px solid var(--red)44", marginBottom: 12 }}>
                <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: "var(--red)" }} />
                <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: "var(--red)" }}>{error}</span>
              </div>
            )}

            {!chainData && !loading && !error && (
              <div style={{ padding: "24px 0", textAlign: "center" }}>
                <BarChart2 className="h-6 w-6 mx-auto mb-2" style={{ color: "var(--text-disabled)" }} />
                <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: "var(--text-muted)" }}>
                  Load the full options chain — calls and puts across all available expiries,
                  with live bid/ask, Greeks, and IV for each strike.
                </p>
              </div>
            )}

            {chainData && (
              <>
                {/* Chain header */}
                <div style={{ display: "flex", gap: 16, padding: "8px 0 12px",
                  borderBottom: "1px solid var(--border)", marginBottom: 12, flexWrap: "wrap" }}>
                  {[
                    { label: "Underlying",  val: fmt$(chainData.underlying_price) },
                    { label: "ATM IV",       val: fmtPct(chainData.atm_iv) },
                    { label: "HV 30d",       val: fmtPct(chainData.hist_vol_30d) },
                    { label: "Expiries",     val: chainData.expiries.length.toString() },
                    { label: "Total calls",  val: chainData.calls.length.toString() },
                    { label: "Total puts",   val: chainData.puts.length.toString() },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)",
                        textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                        color: "var(--text-primary)" }}>{val}</span>
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", minWidth: 160 }}>
                    <IVGauge rank={chainData.iv_rank} />
                  </div>
                </div>

                {/* Expiry filter chips */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)",
                    alignSelf: "center", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Expiries:
                  </span>
                  {chainData.expiries.map(exp => (
                    <span key={exp} style={{ fontFamily: FONT_MONO, fontSize: 10,
                      background: "var(--bg-inset)", border: "1px solid var(--border)",
                      padding: "2px 6px", color: "var(--text-secondary)" }}>
                      {exp}
                    </span>
                  ))}
                </div>

                <ChainTable
                  contracts={chainData.calls}
                  type="call"
                  underlyingPrice={chainData.underlying_price}
                />
                <ChainTable
                  contracts={chainData.puts}
                  type="put"
                  underlyingPrice={chainData.underlying_price}
                />
              </>
            )}
          </>
        )}
      </div>

      {/* Disclaimer */}
      <div style={{ padding: "6px 14px", background: "var(--bg-raised)",
        borderTop: "1px solid var(--border)" }}>
        <p style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-disabled)", margin: 0 }}>
          Options involve significant risk and are not suitable for all investors. IV rank is approximated
          from 30d historical vol — not 52-week IV history. Greeks calculated via Black-Scholes when
          yfinance data is unavailable. Not financial advice.
        </p>
      </div>
    </div>
  );
}
