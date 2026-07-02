"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { api, type DayTradePick, type DayTradePicksResult, type ChartCandle, type ChartSweepStatus, type ScanHorizon, type ScanUniverse } from "@/lib/api";
import { OptionsPanel } from "./OptionsPanel";
import { useTrader } from "@/store/trader";
import { Zap, RefreshCw, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, BarChart2, Clock } from "lucide-react";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

type ChartPeriod = "6mo" | "3mo" | "1w";

// ── Horizon configuration ─────────────────────────────────────────────────────

interface HorizonMeta {
  label: string;
  description: string;
  hold: string;
  keyMetric: string;
  chartPeriod: ChartPeriod;
  color: string;
}

const HORIZON_META: Record<ScanHorizon, HorizonMeta> = {
  day: {
    label: "Day Trade",
    description: "Intraday/overnight — volume surges, ATR breakouts, RSI extremes",
    hold: "1–2 days",
    keyMetric: "vol_adv_ratio",
    chartPeriod: "3mo",
    color: "#C41E3A",
  },
  swing: {
    label: "Swing",
    description: "1–4 week hold — EMA crossovers, MACD divergence, RSI mean-reversion",
    hold: "1–4 weeks",
    keyMetric: "ret_5d",
    chartPeriod: "3mo",
    color: "#1A6B4A",
  },
  month: {
    label: "1 Month",
    description: "1–3 month — trend quality, Sharpe, Monte Carlo probability",
    hold: "1–3 months",
    keyMetric: "sharpe",
    chartPeriod: "6mo",
    color: "#1565C0",
  },
  quarter: {
    label: "3 Months",
    description: "3–6 month — price momentum, sector strength, medium-term regime",
    hold: "3–6 months",
    keyMetric: "mom_12_1",
    chartPeriod: "6mo",
    color: "#7B1FA2",
  },
  year: {
    label: "6–12 Months",
    description: "6–12 month — Jegadeesh-Titman momentum, Hurst persistence",
    hold: "6–12 months",
    keyMetric: "mom_12_1",
    chartPeriod: "6mo",
    color: "#E65100",
  },
};

const HORIZON_ORDER: ScanHorizon[] = ["day", "swing", "month", "quarter", "year"];

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number, sign = true) {
  return (sign && n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

// ── Miniature SVG line chart ─────────────────────────────────────────────────

function SparkLine({
  candles,
  width = 300,
  height = 80,
}: {
  candles: ChartCandle[];
  width?: number;
  height?: number;
}) {
  if (!candles || candles.length < 2) return null;

  const prices = candles.map(c => c.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const pad = { top: 6, bottom: 6, left: 0, right: 0 };
  const W = width - pad.left - pad.right;
  const H = height - pad.top - pad.bottom;

  const toX = (i: number) => pad.left + (i / (prices.length - 1)) * W;
  const toY = (p: number) => pad.top + (1 - (p - min) / range) * H;

  const path = prices
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `${path} L ${toX(prices.length - 1).toFixed(1)} ${(pad.top + H).toFixed(1)} L ${pad.left} ${(pad.top + H).toFixed(1)} Z`;

  const isGreen = prices[prices.length - 1] >= prices[0];
  const lineColor = isGreen ? "#1A6B4A" : "#C41E3A";

  const lastPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const changePct = ((lastPrice - firstPrice) / firstPrice) * 100;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-fill)" />
        <path d={path} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={toX(prices.length - 1)}
          cy={toY(lastPrice)}
          r="3"
          fill={lineColor}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <div style={{
        position: "absolute", top: "2px", right: "2px",
        fontFamily: FONT_MONO, fontSize: "10px", fontWeight: 700,
        color: isGreen ? "#1A6B4A" : "#C41E3A",
      }}>
        {isGreen ? "+" : ""}{changePct.toFixed(2)}%
      </div>
    </div>
  );
}

function PriceChart({
  symbol,
  sweepStatus,
  defaultPeriod,
}: {
  symbol: string;
  sweepStatus: ChartSweepStatus | null;
  defaultPeriod: ChartPeriod;
}) {
  const [period, setPeriod] = useState<ChartPeriod>(defaultPeriod);
  const [candles, setCandles] = useState<ChartCandle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string>("");

  const loadChart = useCallback(async (sym: string, p: ChartPeriod) => {
    const key = `${sym}:${p}`;
    if (fetchedRef.current === key) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.charts.forSymbol(sym, p);
      setCandles(res.candles);
      fetchedRef.current = key;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not_cached") || msg.includes("404")) {
        setError("chart_not_cached");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchedRef.current = "";
    setCandles(null);
    setError(null);
    loadChart(symbol, period);
  }, [symbol, period, loadChart]);

  const PERIODS: ChartPeriod[] = ["6mo", "3mo", "1w"];

  return (
    <div style={{ background: "var(--bg-base)", border: "1px solid var(--border)", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <BarChart2 style={{ width: "12px", height: "12px", color: "var(--text-muted)" }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Price Chart
          </span>
          {sweepStatus?.source && (
            <span style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)",
              border: "1px solid var(--border)", padding: "1px 4px" }}>
              via {sweepStatus.source === "twelvedata" ? "TwelveData" : "yFinance"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                fontFamily: FONT_MONO, fontSize: "9px", fontWeight: 600,
                padding: "2px 7px",
                background: period === p ? "var(--text-primary)" : "var(--bg-raised)",
                color: period === p ? "var(--bg-base)" : "var(--text-muted)",
                border: `1px solid ${period === p ? "var(--text-primary)" : "var(--border)"}`,
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "80px", gap: "6px" }}>
          <RefreshCw style={{ width: "12px", height: "12px", color: "var(--text-muted)" }}
            className="animate-spin" />
          <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
            Loading chart…
          </span>
        </div>
      )}

      {!loading && error === "chart_not_cached" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "80px", gap: "4px", textAlign: "center" }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
            Chart data not yet loaded.
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)" }}>
            {sweepStatus?.swept
              ? "Run a new sweep to refresh chart data."
              : "Click Fetch Charts to load price data for all picks."}
          </span>
        </div>
      )}

      {!loading && error && error !== "chart_not_cached" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "80px" }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: "10px", color: "var(--red)" }}>
            {error}
          </span>
        </div>
      )}

      {!loading && !error && candles && candles.length >= 2 && (
        <div>
          <SparkLine candles={candles} width={400} height={90} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              {candles[0]?.date}
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              Lo {fmt$(Math.min(...candles.map(c => c.low)))} · Hi {fmt$(Math.max(...candles.map(c => c.high)))}
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              {candles[candles.length - 1]?.date}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small building blocks ────────────────────────────────────────────────────

function RegimePill({ regime }: { regime: string }) {
  const r = regime.toLowerCase();
  const color =
    r.includes("trending_up")   ? "var(--green)"  :
    r.includes("trending_down") ? "var(--red)"    :
    r.includes("volatile")      ? "var(--yellow)" :
    r.includes("mean")          ? "var(--blue)"   : "var(--text-muted)";
  const label =
    r.includes("trending_up")   ? "Trending ↑" :
    r.includes("trending_down") ? "Trending ↓" :
    r.includes("volatile")      ? "Volatile"   :
    r.includes("mean")          ? "Mean-Rev"   : "Quiet";
  return (
    <span style={{
      fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
      letterSpacing: "0.08em", textTransform: "uppercase",
      color, border: `1px solid ${color}55`, padding: "1px 5px",
    }}>
      {label}
    </span>
  );
}

function ConfBar({ value, color = "var(--green)" }: { value: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
      <div style={{ flex: 1, height: "4px", background: "var(--bg-active)", borderRadius: 0 }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: "100%", background: color, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: "10px", color: "var(--text-secondary)", flexShrink: 0 }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

const SOURCE_SHORT: Record<string, string> = {
  MeanReversion: "MR", TrendFollow: "TF", Momentum: "MOM", MLSignal: "ML",
  mean_reversion: "MR", trend_follow: "TF", momentum: "MOM", ml_gbm: "ML",
  intraday_momentum: "IM", longterm_momentum: "LT",
};

function SubSignalBadges({ subs }: { subs: DayTradePick["sub_signals"] }) {
  return (
    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
      {subs.map(s => (
        <span key={s.source} style={{
          fontFamily: FONT_MONO, fontSize: "9px", fontWeight: 700,
          color: "var(--green)", background: "var(--green-dim)",
          border: "1px solid var(--green)44", padding: "1px 4px",
        }}>
          {SOURCE_SHORT[s.source] ?? s.source} {Math.round(s.confidence * 100)}%
        </span>
      ))}
    </div>
  );
}

// ── Horizon-specific key metric cell ─────────────────────────────────────────

function HorizonMetricCell({ pick, horizon }: { pick: DayTradePick; horizon: ScanHorizon }) {
  const meta = HORIZON_META[horizon];

  if (horizon === "day") {
    const v = pick.vol_adv_ratio;
    const color = v > 2 ? "var(--green)" : v > 1.3 ? "var(--yellow)" : "var(--text-muted)";
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600, color }}>
          {v.toFixed(2)}×
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)" }}>Vol/ADV</div>
      </div>
    );
  }
  if (horizon === "swing") {
    const v = pick.ret_5d;
    const color = v > 0 ? "var(--green)" : "var(--red)";
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600, color }}>
          {v > 0 ? "+" : ""}{v.toFixed(2)}%
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)" }}>5d ret</div>
      </div>
    );
  }
  if (horizon === "month") {
    const v = pick.sharpe;
    const color = v >= 1.5 ? "var(--green)" : v >= 0.8 ? "var(--yellow)" : "var(--text-muted)";
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600, color }}>
          {v.toFixed(2)}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)" }}>Sharpe</div>
      </div>
    );
  }
  // quarter or year — 12-1mo momentum
  const v = pick.mom_12_1;
  const color = v > 20 ? "var(--green)" : v > 5 ? "var(--yellow)" : v < 0 ? "var(--red)" : "var(--text-muted)";
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600, color }}>
        {v > 0 ? "+" : ""}{v.toFixed(1)}%
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)" }}>12-1mo mom</div>
    </div>
  );
}

// ── Row with expandable trade brief + chart ──────────────────────────────────

function PickRow({
  pick, accountSize, onSelect, rank, sweepStatus, horizon,
}: {
  pick: DayTradePick;
  accountSize: number;
  onSelect: (sym: string) => void;
  rank: number;
  sweepStatus: ChartSweepStatus | null;
  horizon: ScanHorizon;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const meta = HORIZON_META[horizon];

  const dollarAlloc  = accountSize * (pick.position_size_pct / 100);
  const shares       = pick.price > 0 ? Math.floor(dollarAlloc / pick.price) : 0;
  const actualDollar = shares * pick.price;
  const expRetPct    = pick.expected_return;            // already a pct (e.g. 2.5 = 2.5%)
  const potentialGain = actualDollar * (pick.expected_return / 100);
  const isTop3 = rank <= 3;

  return (
    <>
      <tr
        style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
        onClick={() => setExpanded(e => !e)}
      >
        <td style={{ padding: "8px 6px 8px 12px", width: "32px" }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700,
            color: isTop3 ? meta.color : "var(--text-muted)",
          }}>#{rank}</span>
        </td>

        <td style={{ padding: "8px 8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <div className="flex items-center gap-1.5">
              <span style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                {pick.symbol}
              </span>
              <span style={{
                fontFamily: FONT_MONO, fontSize: "8px", fontWeight: 800,
                padding: "1px 5px", letterSpacing: "0.1em",
                background: pick.direction === "short" ? "var(--red-dim)" : "rgba(26,107,74,0.12)",
                color: pick.direction === "short" ? "var(--red)" : "var(--green)",
                border: `1px solid ${pick.direction === "short" ? "var(--red)" : "var(--green)"}44`,
              }}>
                {pick.direction === "short" ? "SHORT" : "LONG"}
              </span>
            </div>
            <RegimePill regime={pick.regime} />
          </div>
        </td>

        <td style={{ padding: "8px", textAlign: "right" }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
            {fmt$(pick.price)}
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: "10px", color: pick.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
            {fmtPct(pick.change_pct)}
          </div>
        </td>

        <td style={{ padding: "8px", minWidth: "120px" }}>
          <ConfBar value={pick.confidence} color={meta.color} />
        </td>

        <td style={{ padding: "8px", textAlign: "right" }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700,
            color: expRetPct > 0 ? "var(--green)" : "var(--red)",
          }}>
            {expRetPct > 0 ? "+" : ""}{expRetPct.toFixed(2)}%
          </span>
          <div style={{ fontFamily: FONT_MONO, fontSize: "8px", color: "var(--text-muted)" }}>
            over {meta.hold}
          </div>
        </td>

        <td style={{ padding: "8px", textAlign: "center" }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: "11px", fontWeight: 600,
            color: pick.mc_prob_positive >= 60 ? "var(--green)" : pick.mc_prob_positive >= 50 ? "var(--yellow)" : "var(--red)",
          }}>
            {pick.mc_prob_positive}%
          </span>
        </td>

        <td style={{ padding: "8px", textAlign: "right" }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-secondary)" }}>
            {pick.position_size_pct.toFixed(1)}%
          </div>
          {shares > 0 && (
            <div style={{ fontFamily: FONT_MONO, fontSize: "9px", color: "var(--text-muted)" }}>
              ~{shares} sh
            </div>
          )}
        </td>

        {/* Horizon-specific key metric */}
        <td style={{ padding: "8px" }}>
          <HorizonMetricCell pick={pick} horizon={horizon} />
        </td>

        <td style={{ padding: "8px" }}>
          <SubSignalBadges subs={pick.sub_signals} />
        </td>

        <td style={{ padding: "8px 12px 8px 4px", textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "flex-end" }}>
            <button
              onClick={e => { e.stopPropagation(); onSelect(pick.symbol); }}
              style={{
                fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--blue)", background: "var(--blue-dim)",
                border: "1px solid var(--blue)44", padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              Full Analysis →
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                setExpanded(true);
                setShowOptions(v => !v);
              }}
              style={{
                fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: showOptions ? "#fff" : "var(--green)",
                background: showOptions ? "var(--green)" : "var(--green-dim)",
                border: "1px solid var(--green)44", padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              Options
            </button>
            <span style={{ color: "var(--text-muted)", display: "flex" }}>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={10} style={{ padding: 0 }}>
            <div style={{
              padding: "12px 16px",
              background: "var(--bg-raised)",
              borderBottom: `2px solid ${meta.color}44`,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 420px", gap: "10px" }}>
                {/* Entry */}
                <div style={{ background: "var(--green-dim)", border: "1px solid var(--green)33", padding: "10px 12px" }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                    letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--green)", marginBottom: "6px" }}>
                    ▲ Entry — Buy
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>
                    {shares > 0 ? `${shares} shares` : "< 1 share"}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-secondary)", marginTop: "3px" }}>
                    @ {fmt$(pick.price)} = {fmt$(actualDollar)}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                    {pick.position_size_pct.toFixed(1)}% Kelly of {fmt$(accountSize)} · Hold {meta.hold}
                  </div>
                </div>

                {/* Potential gain */}
                <div style={{ background: "var(--bg-active)", border: "1px solid var(--border)", padding: "10px 12px" }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                    letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
                    Potential Gain
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: 700,
                    color: potentialGain >= 0 ? "var(--green)" : "var(--red)", lineHeight: 1 }}>
                    {potentialGain >= 0 ? "+" : ""}{fmt$(Math.abs(potentialGain))}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-secondary)", marginTop: "3px" }}>
                    {fmtPct(expRetPct)} over {meta.hold}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                    {pick.mc_prob_positive}% Monte Carlo probability
                  </div>
                </div>

                {/* Risk snapshot */}
                <div style={{ background: "var(--red-dim)", border: "1px solid var(--red)33", padding: "10px 12px" }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                    letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--red)", marginBottom: "6px" }}>
                    Risk Snapshot
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "13px", fontWeight: 700, color: "var(--red)", lineHeight: 1.3 }}>
                    Max DD: {(pick.max_drawdown * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: "11px", color: "var(--text-secondary)", marginTop: "3px" }}>
                    Sharpe {pick.sharpe.toFixed(2)} · ATR {(pick.atr_pct * 100).toFixed(2)}%
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Hurst {pick.hurst.toFixed(3)} · Vol/ADV {pick.vol_adv_ratio.toFixed(2)}×
                  </div>
                </div>

                {/* Price chart */}
                <PriceChart symbol={pick.symbol} sweepStatus={sweepStatus} defaultPeriod={meta.chartPeriod} />
              </div>

              {/* Extended metrics bar for longer horizons */}
              {(pick.horizon === "quarter" || pick.horizon === "year") && (
                <div style={{
                  marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
                }}>
                  {[
                    { label: "12-1mo Momentum", value: `${pick.mom_12_1 > 0 ? "+" : ""}${pick.mom_12_1.toFixed(1)}%` },
                    { label: "3d Momentum", value: `${pick.mom_3 > 0 ? "+" : ""}${pick.mom_3.toFixed(2)}%` },
                    { label: "Hurst (trend persistence)", value: pick.hurst.toFixed(3) },
                    { label: "5d Return", value: `${pick.ret_5d > 0 ? "+" : ""}${pick.ret_5d.toFixed(2)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "var(--bg-base)", border: "1px solid var(--border)", padding: "6px 10px" }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: "8px", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
                      <div style={{ fontFamily: FONT_MONO, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Rationale */}
              <div style={{
                marginTop: "10px", padding: "10px 14px",
                background: "var(--blue-dim)", border: "1px solid rgba(11,31,58,0.15)",
                fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.75,
              }}>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Why the AI picked this: </span>
                {buildRationale(pick, horizon)}
              </div>

              {/* Options Panel (inline, lazy) */}
              {showOptions && (
                <div style={{ marginTop: "10px" }}>
                  <OptionsPanel symbol={pick.symbol} horizon={horizon} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function buildRationale(pick: DayTradePick, horizon: ScanHorizon): string {
  const parts: string[] = [];
  const isShort = pick.direction === "short";
  const srcNames: Record<string, string> = {
    mean_reversion: "mean-reversion", trend_follow: "trend-following",
    momentum: "momentum", ml_gbm: "machine learning",
    intraday_momentum: "intraday-momentum", longterm_momentum: "long-term momentum",
    MeanReversion: "mean-reversion", TrendFollow: "trend-following",
    Momentum: "momentum", MLSignal: "machine learning",
  };
  const sigDir = isShort ? -1 : 1;
  const agreeing = pick.sub_signals.filter(s => s.direction === sigDir);
  if (agreeing.length >= 3) {
    parts.push(`All ${agreeing.length} sub-models agree: ${agreeing.map(s => srcNames[s.source] ?? s.source).join(", ")} are all pointing ${isShort ? "SHORT" : "LONG"}.`);
  } else if (agreeing.length > 0) {
    parts.push(`${agreeing.map(s => srcNames[s.source] ?? s.source).join(" and ")} signal a ${isShort ? "sell/put opportunity" : "buying opportunity"}.`);
  }

  const r = pick.regime.toLowerCase();
  if (isShort) {
    if (r.includes("trending_down")) parts.push("The trend is clearly downward — short sellers have the wind at their backs.");
    else if (r.includes("mean_reverting")) parts.push("The stock is overextended and mean-reverting — a fade from overbought levels is likely.");
    else if (r.includes("volatile")) parts.push("High volatility boosts put premium value — option sellers profit from elevated IV.");
  } else {
    if (r.includes("trending_up")) parts.push("The trend is clearly upward — momentum traders have the wind at their backs.");
    else if (r.includes("mean_reverting")) parts.push("The stock is mean-reverting, suggesting a bounce from oversold conditions.");
    else if (r.includes("volatile")) parts.push("Market is volatile — high-confidence signals carry more edge than usual.");
  }

  if (horizon === "day") {
    if (pick.vol_adv_ratio > 2.0) parts.push(`Volume is ${pick.vol_adv_ratio.toFixed(1)}× its 20-day average — strong institutional participation today.`);
    if (isShort) {
      if (pick.rsi > 70) parts.push(`RSI of ${pick.rsi} is overbought — classic intraday reversal short setup.`);
      if (pick.atr_pct > 1.5) parts.push(`ATR of ${(pick.atr_pct * 100).toFixed(1)}% gives ample downside range for puts to pay off.`);
    } else {
      if (pick.rsi < 35) parts.push(`RSI of ${pick.rsi} is oversold — classic intraday reversal setup.`);
      else if (pick.rsi > 60 && r.includes("trending")) parts.push(`RSI of ${pick.rsi} shows momentum without being overbought.`);
      if (pick.atr_pct > 1.5) parts.push(`ATR of ${(pick.atr_pct * 100).toFixed(1)}% gives ample intraday range for a profitable trade.`);
    }
  } else if (horizon === "swing") {
    if (isShort) {
      if (pick.rsi > 65) parts.push(`RSI of ${pick.rsi} is overbought — swing traders look for a reversal here.`);
      if (pick.ret_5d < -2) parts.push(`5-day decline of ${pick.ret_5d.toFixed(2)}% shows emerging bearish momentum.`);
    } else {
      if (pick.rsi < 40) parts.push(`RSI of ${pick.rsi} is oversold — swing traders look for a bounce here.`);
      if (pick.ret_5d > 2) parts.push(`5-day return of +${pick.ret_5d.toFixed(2)}% shows emerging momentum.`);
    }
  } else if (horizon === "month") {
    if (pick.sharpe >= 1.2) parts.push(`Historical Sharpe of ${pick.sharpe.toFixed(2)} is strong — consistent risk-adjusted returns.`);
    if (isShort) {
      if (pick.mc_prob_positive <= 40) parts.push(`Monte Carlo gives only ${pick.mc_prob_positive}% odds of a positive return — bearish tilt.`);
    } else {
      if (pick.mc_prob_positive >= 65) parts.push(`Monte Carlo gives ${pick.mc_prob_positive}% odds of a positive 1-month return.`);
    }
  } else if (horizon === "quarter" || horizon === "year") {
    if (isShort) {
      if (pick.mom_12_1 < -10) parts.push(`12-month return of ${pick.mom_12_1.toFixed(1)}% is deeply negative — momentum losers continue losing.`);
      if (pick.hurst > 0.58) parts.push(`Hurst exponent of ${pick.hurst.toFixed(3)} confirms the downtrend is persistent, not random noise.`);
    } else {
      if (pick.mom_12_1 > 15) parts.push(`12-month momentum of +${pick.mom_12_1.toFixed(1)}% puts this in the top decile — classic Jegadeesh-Titman winner.`);
      if (pick.hurst > 0.58) parts.push(`Hurst exponent of ${pick.hurst.toFixed(3)} confirms trend persistence — this momentum is structural, not random.`);
      if (pick.mc_prob_positive >= 65) parts.push(`Monte Carlo gives ${pick.mc_prob_positive}% probability of a positive return over the next ${horizon === "year" ? "6–12 months" : "quarter"}.`);
    }
  }

  return parts.join(" ") || `Multiple quant signals align for a ${isShort ? "SHORT/put entry" : "LONG entry"} with positive expected value.`;
}

// ── Chart sweep status banner ────────────────────────────────────────────────

function ChartSweepBanner({
  sweepStatus, onSweep, sweeping,
}: {
  sweepStatus: ChartSweepStatus | null;
  onSweep: () => void;
  sweeping: boolean;
}) {
  const cached = sweepStatus?.symbols_cached ?? 0;
  const stale  = sweepStatus?.stale ?? true;
  const swept  = sweepStatus?.swept ?? false;
  const ageMin = sweepStatus?.age_seconds ? Math.round(sweepStatus.age_seconds / 60) : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      padding: "7px 12px",
      background: swept && !stale ? "var(--green-dim)" : "var(--bg-raised)",
      border: `1px solid ${swept && !stale ? "var(--green)33" : "var(--border)"}`,
      borderLeft: `3px solid ${swept && !stale ? "var(--green)" : stale ? "#8B6914" : "var(--border)"}`,
    }}>
      <BarChart2 style={{ width: "12px", height: "12px", flexShrink: 0,
        color: swept && !stale ? "var(--green)" : "var(--text-muted)" }} />
      <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-secondary)", flex: 1, minWidth: 0 }}>
        {sweeping
          ? "Fetching price charts for all picks — runs in background, ~2 min for 80 stocks…"
          : swept && !stale
            ? `Charts loaded: ${cached} stocks cached · ${ageMin != null ? `${ageMin}min ago` : "fresh"} via ${sweepStatus?.source === "twelvedata" ? "TwelveData" : "yFinance"}`
            : stale && swept
              ? `Charts are stale (${ageMin != null ? `${ageMin}min ago` : "old"}) — click to refresh`
              : "Price charts not yet loaded — click to fetch for all picks (runs in background)"
        }
      </span>
      <button
        onClick={onSweep}
        disabled={sweeping}
        style={{
          fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: sweeping ? "var(--text-muted)" : "var(--blue)",
          background: "var(--blue-dim)", border: "1px solid var(--blue)33",
          padding: "3px 10px", cursor: sweeping ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", gap: "4px", flexShrink: 0,
        }}
      >
        {sweeping
          ? <><RefreshCw style={{ width: "10px", height: "10px" }} className="animate-spin" /> Fetching…</>
          : <><BarChart2 style={{ width: "10px", height: "10px" }} /> {stale ? "Refresh Charts" : "Fetch Charts"}</>
        }
      </button>
    </div>
  );
}

// ── Horizon selector ─────────────────────────────────────────────────────────

function HorizonSelector({
  horizon, onChange,
}: {
  horizon: ScanHorizon;
  onChange: (h: ScanHorizon) => void;
}) {
  const meta = HORIZON_META[horizon];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
        {HORIZON_ORDER.map(h => {
          const m = HORIZON_META[h];
          const active = h === horizon;
          return (
            <button
              key={h}
              onClick={() => onChange(h)}
              style={{
                fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 600,
                letterSpacing: "0.06em",
                padding: "5px 12px",
                background: active ? m.color : "var(--bg-raised)",
                color: active ? "#FFFFFF" : "var(--text-secondary)",
                border: `1px solid ${active ? m.color : "var(--border)"}`,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)",
      }}>
        <Clock style={{ width: "10px", height: "10px" }} />
        <span>Hold: <strong style={{ color: "var(--text-secondary)" }}>{meta.hold}</strong></span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span>{meta.description}</span>
      </div>
    </div>
  );
}

// ── Column header label per horizon ──────────────────────────────────────────

function horizonColLabel(horizon: ScanHorizon): string {
  if (horizon === "day")     return "Vol/ADV";
  if (horizon === "swing")   return "5d Ret";
  if (horizon === "month")   return "Sharpe";
  return "12-1mo";
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function DayTradePicksPanel({
  onSelectSymbol,
}: {
  onSelectSymbol: (sym: string) => void;
}) {
  const portfolioCapital = useTrader(s => s.portfolioCapital);

  const [horizon, setHorizon]             = useState<ScanHorizon>("day");
  const [universe, setUniverse]           = useState<ScanUniverse>("sp500");
  const [includeShorts, setIncludeShorts] = useState(false);
  const [data, setData]                   = useState<DayTradePicksResult | null>(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [accountSize, setAccountSize]     = useState(() => portfolioCapital ?? 10_000);
  const [scanStarted, setScanStarted]     = useState(false);
  const prevHorizonRef                    = useRef<ScanHorizon>("day");

  // Chart sweep state
  const [sweepStatus, setSweepStatus]     = useState<ChartSweepStatus | null>(null);
  const [sweeping, setSweeping]           = useState(false);
  const sweepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check sweep status on mount
  useEffect(() => {
    api.charts.sweep(false).then(setSweepStatus).catch(() => {});
  }, []);

  const triggerSweep = useCallback(async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      const res = await api.charts.sweep(true);
      setSweepStatus(res);
    } catch { /* ignore */ }

    if (sweepPollRef.current) clearInterval(sweepPollRef.current);
    sweepPollRef.current = setInterval(async () => {
      try {
        const status = await api.charts.sweep(false);
        setSweepStatus(status);
        if (status.finished_at) {
          setSweeping(false);
          if (sweepPollRef.current) clearInterval(sweepPollRef.current);
        }
      } catch { /* ignore */ }
    }, 15_000);
  }, [sweeping]);

  useEffect(() => () => {
    if (sweepPollRef.current) clearInterval(sweepPollRef.current);
  }, []);

  const runScan = useCallback(async (h: ScanHorizon = horizon, u: ScanUniverse = universe, shorts: boolean = includeShorts) => {
    setLoading(true);
    setError(null);
    setScanStarted(true);
    try {
      const result = await api.dayTradePicks(20, h, u, shorts);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [horizon, universe]);

  // When horizon or universe changes and a scan has already run, auto-re-scan
  const handleHorizonChange = useCallback((h: ScanHorizon) => {
    setHorizon(h);
    if (scanStarted) {
      setTimeout(() => runScan(h, universe, includeShorts), 0);
    }
  }, [scanStarted, runScan, universe, includeShorts]);

  const handleUniverseChange = useCallback((u: ScanUniverse) => {
    setUniverse(u);
    if (scanStarted) {
      setTimeout(() => runScan(horizon, u, includeShorts), 0);
    }
  }, [scanStarted, runScan, horizon, includeShorts]);

  const handleShortsToggle = useCallback((shorts: boolean) => {
    setIncludeShorts(shorts);
    if (scanStarted) {
      setTimeout(() => runScan(horizon, universe, shorts), 0);
    }
  }, [scanStarted, runScan, horizon, universe]);

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString()
    : null;

  const activeMeta = HORIZON_META[horizon];

  return (
    <div className="space-y-3">
      {/* Horizon + Universe selector */}
      <div className="panel p-3">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
              Trading Horizon
            </div>
            <HorizonSelector horizon={horizon} onChange={handleHorizonChange} />
          </div>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
              letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
              Stock Universe
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              {(["sp500", "nasdaq", "both"] as ScanUniverse[]).map(u => (
                <button key={u} onClick={() => handleUniverseChange(u)}
                  style={{
                    fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 600,
                    padding: "5px 12px", cursor: "pointer",
                    background: universe === u ? "var(--accent)" : "var(--bg-raised)",
                    color: universe === u ? "#fff" : "var(--text-secondary)",
                    border: `1px solid ${universe === u ? "var(--accent)" : "var(--border)"}`,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                  {u === "sp500" ? "S&P 500" : u === "nasdaq" ? "NASDAQ" : "Both"}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "9px", color: "var(--text-muted)", marginTop: 4 }}>
              {universe === "nasdaq"
                ? "~200 NASDAQ names incl. high-beta growth & crypto-adjacent"
                : universe === "both"
                ? "Combined S&P 500 + NASDAQ — widest universe"
                : "S&P 500 top ~80 by market cap — most liquid"}
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel p-3">
          <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>Top Opportunities Found</div>
          <div className="num text-2xl font-bold mt-0.5" style={{ color: activeMeta.color }}>
            {data?.horizon === horizon ? data.total_picks : "—"}
          </div>
        </div>
        <div className="panel p-3">
          <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>Stocks Scanned</div>
          <div className="num text-2xl font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
            {data?.horizon === horizon ? data.scanned_total : "—"}
          </div>
        </div>
        <div className="panel p-3">
          <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
            {includeShorts ? "Buy / Sell setups" : "Buy Signals"}
          </div>
          <div className="num text-2xl font-bold mt-0.5" style={{ color: "var(--blue)" }}>
            {data?.horizon === horizon
              ? includeShorts
                ? `${data.scanned_long ?? 0} / ${data.scanned_short ?? 0}`
                : data.scanned_long
              : "—"}
          </div>
        </div>
        <div className="panel p-3">
          <div style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>Last Updated</div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: FONT_MONO }}>
            {data?.horizon === horizon && generatedAt ? generatedAt : "—"}
          </div>
        </div>
      </div>

      {/* Chart sweep banner */}
      <ChartSweepBanner
        sweepStatus={sweepStatus}
        onSweep={triggerSweep}
        sweeping={sweeping}
      />

      {/* Main results panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" style={{ color: activeMeta.color }} />
            <span>Top {activeMeta.label} Picks — Right Now</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>Account:</span>
              <div className="flex items-center" style={{ background: "#FFFFFF", border: "1px solid var(--border)" }}>
                <span className="px-1.5 text-xs" style={{ color: "var(--text-muted)" }}>$</span>
                <input
                  type="number"
                  value={accountSize}
                  onChange={e => setAccountSize(Math.max(100, Number(e.target.value)))}
                  className="bg-transparent outline-none text-xs num py-0.5 pr-2 w-24"
                  style={{ color: "var(--text-primary)", fontFamily: FONT_MONO }}
                />
              </div>
            </div>

            {data?.horizon === horizon && generatedAt && (
              <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
                Cached 5min · refresh anytime
              </span>
            )}

            {/* Shorts toggle */}
            <button
              onClick={() => handleShortsToggle(!includeShorts)}
              title={includeShorts ? "Showing longs + shorts — click to hide shorts" : "Click to include bearish/put setups"}
              style={{
                fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 600,
                letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "5px 10px",
                background: includeShorts ? "var(--red-dim)" : "var(--bg-raised)",
                color: includeShorts ? "var(--red)" : "var(--text-muted)",
                border: `1px solid ${includeShorts ? "var(--red)" : "var(--border)"}`,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {includeShorts ? "▼ Shorts On" : "▼ Shorts Off"}
            </button>

            <button
              onClick={() => runScan(horizon, universe, includeShorts)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5"
              style={{
                fontFamily: FONT_BODY, fontSize: "10px", fontWeight: 600,
                letterSpacing: "0.1em", textTransform: "uppercase",
                background: loading ? "var(--bg-active)" : `${activeMeta.color}22`,
                color: loading ? "var(--text-muted)" : activeMeta.color,
                border: `1px solid ${loading ? "var(--border)" : activeMeta.color + "44"}`,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading
                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Scanning…</>
                : <><Zap className="h-3 w-3" /> {data?.horizon === horizon ? "Refresh Scan" : "Run Scan"}</>
              }
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs"
            style={{ background: "var(--red-dim)", borderBottom: "1px solid var(--red)", color: "var(--red)" }}>
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => runScan(horizon, universe)} className="underline opacity-70 hover:opacity-100 ml-auto">retry</button>
          </div>
        )}

        {/* Pre-scan splash */}
        {!scanStarted && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-5 text-center px-8">
            <TrendingUp className="h-10 w-10" style={{ color: activeMeta.color, opacity: 0.7 }} />
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                Let AI find your best trades right now
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.75, maxWidth: "480px" }}>
                Pick how long you want to hold, then hit <strong>Scan Now</strong>. We analyse every major stock and surface the ones with the strongest signals — with exact entry, stop-loss, and target prices ready for you.
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-center" style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)" }}>
              {[
                "Day Trade: best stocks for today",
                "Swing: hold 1–4 weeks",
                "Long-term: hold months",
                "Exact dollar amounts to invest",
                "Win probability for every pick",
              ].map(f => (
                <span key={f} style={{ border: "1px solid var(--border)", padding: "4px 12px", background: "var(--bg-raised)" }}>✓ {f}</span>
              ))}
            </div>
            <button
              onClick={() => runScan(horizon, universe)}
              className="flex items-center gap-2 px-8 py-3 mt-1"
              style={{
                fontFamily: FONT_BODY, fontSize: "14px", fontWeight: 700,
                background: activeMeta.color, color: "#FFFFFF",
                border: "none", cursor: "pointer",
              }}
            >
              <Zap className="h-4 w-4" /> Scan Now
            </button>
            <div style={{ fontFamily: FONT_BODY, fontSize: "11px", color: "var(--text-muted)" }}>
              Takes about 25 seconds · Covers {universe === "both" ? "800+" : "500+"} stocks
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <RefreshCw className="h-8 w-8 animate-spin" style={{ color: activeMeta.color }} />
            <div style={{ fontFamily: FONT_BODY, fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
              Scanning {universe === "both" ? "800+" : "500+"} stocks for the best {activeMeta.label.toLowerCase()} opportunities…
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)" }}>
              Analysing signals, risk, and probability for every stock · ~25 seconds
            </div>
            <div style={{ width: "240px", height: "3px", background: "var(--bg-active)", overflow: "hidden" }}>
              <div style={{
                height: "100%", background: activeMeta.color,
                animation: "progress-indeterminate 1.5s ease-in-out infinite",
                width: "40%",
              }} />
            </div>
          </div>
        )}

        {/* Results */}
        {data?.horizon === horizon && !loading && data.picks.length > 0 && (
          <>
            <div className="px-4 py-2 flex items-center gap-2"
              style={{ background: "var(--yellow-dim)", borderBottom: "1px solid var(--yellow)33" }}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0" style={{ color: "var(--yellow)" }} />
              <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--yellow)", lineHeight: 1.5 }}>
                These are AI-generated trade ideas, not financial advice. Always set a stop-loss before entering any trade. Click any row to see your exact entry, stop-loss, and target prices.
              </span>
            </div>

            <div className="overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-raised)", borderBottom: "2px solid var(--border)" }}>
                    {[
                      ["#", "left", "32px"],
                      ["Symbol", "left", ""],
                      ["Price", "right", ""],
                      ["Confidence", "left", "140px"],
                      ["Exp. Return", "right", ""],
                      ["MC Prob", "center", ""],
                      ["Kelly / Shares", "right", ""],
                      [horizonColLabel(horizon), "right", ""],
                      ["Signals", "left", ""],
                      ["", "right", ""],
                    ].map(([label, align, width], i) => (
                      <th key={i} style={{
                        padding: "7px 8px",
                        textAlign: align as "left" | "right" | "center",
                        ...(i === 0 ? { paddingLeft: "12px" } : {}),
                        ...(width ? { width } : {}),
                        fontFamily: FONT_BODY, fontSize: "9px", fontWeight: 600,
                        letterSpacing: "0.14em", textTransform: "uppercase",
                        color: "var(--text-muted)", whiteSpace: "nowrap",
                      }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.picks.map(pick => (
                    <PickRow
                      key={pick.symbol}
                      pick={pick}
                      accountSize={accountSize}
                      onSelect={onSelectSymbol}
                      rank={pick.rank}
                      sweepStatus={sweepStatus}
                      horizon={horizon}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2"
              style={{ borderTop: "1px solid var(--border)", background: "var(--bg-raised)" }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
                Showing top {data.total_picks} picks ({data.scanned_long} long{includeShorts ? ` · ${data.scanned_short ?? 0} short` : ""}) from {data.scanned_total} stocks scanned
              </span>
              <span style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--text-muted)" }}>
                Scores = horizon-tuned composite · Click any row to expand trade brief + chart
              </span>
            </div>
          </>
        )}

        {/* No picks */}
        {data?.horizon === horizon && !loading && data.picks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div style={{ fontFamily: FONT_BODY, fontSize: "14px", color: "var(--text-secondary)" }}>
              No strong {includeShorts ? "directional" : "LONG"} signals found for {activeMeta.label} right now
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: "12px", color: "var(--text-muted)", maxWidth: "400px", lineHeight: 1.6 }}>
              The market may be in a low-conviction or mixed-signal environment for this time frame.
              Try a different horizon or check back later.
            </div>
            <button onClick={() => runScan(horizon, universe)} className="flex items-center gap-1.5 px-4 py-2 mt-2"
              style={{ fontFamily: FONT_BODY, fontSize: "10px", color: "var(--blue)",
                background: "var(--blue-dim)", border: "1px solid var(--blue)44", cursor: "pointer" }}>
              <RefreshCw className="h-3 w-3" /> Try Again
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
