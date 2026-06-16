import { Metadata } from "next";
import Link from "next/link";
import { BarChart2, ArrowLeft, ExternalLink } from "lucide-react";

interface Props {
  params: Promise<{ symbol: string }>;
}

async function getAnalysis(symbol: string) {
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3002";
    const res = await fetch(`${base}/api/analyze?symbol=${encodeURIComponent(symbol)}&period=1y`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  return {
    title: `${sym} Analysis · QuantTrader`,
    description: `AI-powered quant analysis for ${sym} — signal, regime, risk metrics, and Monte Carlo simulation.`,
    openGraph: {
      title: `${sym} Analysis · QuantTrader`,
      description: `Get the full AI signal breakdown for ${sym}. Powered by institutional quant methodology.`,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${sym} Analysis · QuantTrader`,
      description: `AI signal, risk metrics & Monte Carlo for ${sym}`,
    },
  };
}

function signalColor(s: number): string {
  return s === 1 ? "#1A6B4A" : s === -1 ? "#C41E3A" : "#6B6B6B";
}
function regimeColor(r: string): string {
  const map: Record<string, string> = {
    trending_up: "#1A6B4A", trending_down: "#C41E3A",
    mean_reverting: "#8B6914", volatile: "#8B6914", quiet: "#6B6B6B",
  };
  return map[r] ?? "#6B6B6B";
}

export default async function AnalysisSharePage({ params }: Props) {
  const { symbol } = await params;
  const sym  = symbol.toUpperCase();
  const data = await getAnalysis(sym);

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" }}>
      {/* Nav */}
      <header style={{ background: "#0B1F3A", borderBottom: "2px solid #C41E3A", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: "640px", margin: "0 auto", padding: "0 24px", height: "48px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
            <div style={{ background: "rgba(196,30,58,0.2)", border: "1px solid rgba(196,30,58,0.4)", padding: "6px", display: "flex" }}>
              <BarChart2 style={{ width: "16px", height: "16px", color: "#C41E3A" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1 }}>
              <span style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: "14px", fontWeight: 600, color: "#FFFFFF", letterSpacing: "0.02em" }}>
                QuantTrader
              </span>
              <span style={{ fontSize: "8px", fontWeight: 400, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: "1px" }}>
                ML-POWERED
              </span>
            </div>
          </Link>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "rgba(255,255,255,0.5)", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            <ArrowLeft style={{ width: "12px", height: "12px" }} /> Live App
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {!data ? (
          <div style={{ textAlign: "center", padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <div style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: "48px", fontWeight: 700, color: "#D0CAC0" }}>{sym}</div>
            <p style={{ color: "#6B6B6B", fontSize: "14px" }}>Could not load analysis. The market may be closed or the ticker invalid.</p>
            <Link href={`/?symbol=${sym}`} style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "8px 18px", background: "#C41E3A", color: "#fff",
              textDecoration: "none", fontSize: "12px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.1em", marginTop: "8px",
            }}>
              Try in Live App
            </Link>
          </div>
        ) : (
          <>
            {/* Hero card */}
            <div style={{ background: "#FFFFFF", border: "1px solid #D0CAC0", borderTop: "3px solid #C41E3A", padding: "24px" }}>
              <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C41E3A", marginBottom: "10px", fontFamily: "'Palatino Linotype', Palatino, serif" }}>
                QuantTrader — AI Analysis
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <h1 style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: "32px", fontWeight: 700, color: "#0B1F3A", margin: 0 }}>
                  {data.symbol}
                </h1>
                <span style={{ fontFamily: "monospace", fontSize: "22px", fontWeight: 700, color: "#1A1A1A" }}>
                  ${data.price?.toFixed(2)}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: 600, color: data.change_pct >= 0 ? "#1A6B4A" : "#C41E3A" }}>
                  {data.change_pct >= 0 ? "+" : ""}{data.change_pct?.toFixed(2)}%
                </span>
              </div>
              <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "9px", color: "#6B6B6B", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "4px" }}>Signal</div>
                  <div style={{ fontFamily: "monospace", fontSize: "22px", fontWeight: 700, color: signalColor(data.composite_signal) }}>
                    {data.composite_signal === 1 ? "▲ LONG" : data.composite_signal === -1 ? "▼ SHORT" : "■ FLAT"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "#6B6B6B", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "4px" }}>Confidence</div>
                  <div style={{ fontFamily: "monospace", fontSize: "22px", fontWeight: 700, color: "#0B1F3A" }}>
                    {((data.composite_confidence ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "#6B6B6B", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "4px" }}>Regime</div>
                  <div style={{ fontFamily: "'Palatino Linotype', Palatino, serif", fontSize: "14px", fontWeight: 600, textTransform: "capitalize", color: regimeColor(data.regime) }}>
                    {data.regime?.replace(/_/g, " ")}
                  </div>
                </div>
              </div>
            </div>

            {/* Risk metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
              {[
                { label: "Sharpe Ratio", value: data.risk_metrics?.sharpe?.toFixed(2) },
                { label: "Sortino Ratio", value: data.risk_metrics?.sortino?.toFixed(2) },
                { label: "MC Profit Probability", value: `${data.monte_carlo?.prob_positive}%` },
                { label: "Kelly Position Size", value: `${data.position_size_pct}%` },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#FFFFFF", border: "1px solid #D0CAC0", padding: "14px 16px" }}>
                  <div style={{ fontSize: "9px", color: "#6B6B6B", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "6px" }}>{label}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "20px", fontWeight: 700, color: "#0B1F3A" }}>{value ?? "—"}</div>
                </div>
              ))}
            </div>

            {/* Sub-signals */}
            {data.signals?.length > 0 && (
              <div style={{ background: "#FFFFFF", border: "1px solid #D0CAC0" }}>
                <div style={{ padding: "8px 14px", background: "#F8F6F2", borderBottom: "1px solid #D0CAC0", fontSize: "9px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.16em", color: "#6B6B6B" }}>
                  Sub-Model Signals
                </div>
                <div style={{ padding: "4px 0" }}>
                  {data.signals.map((s: { source?: string; direction: number; confidence: number }, i: number) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 16px", borderBottom: i < data.signals.length - 1 ? "1px solid #D0CAC0" : "none",
                    }}>
                      <span style={{ fontSize: "12px", color: "#3D3D3D", textTransform: "capitalize" }}>
                        {s.source?.replace(/_/g, " ")}
                      </span>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: 700, color: signalColor(s.direction) }}>
                        {s.direction === 1 ? "▲ LONG" : s.direction === -1 ? "▼ SHORT" : "■ FLAT"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            <div style={{ background: "#FFFFFF", border: "1px solid #D0CAC0", borderTop: "3px solid #0B1F3A", padding: "24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
              <p style={{ fontSize: "13px", color: "#6B6B6B", lineHeight: 1.6, maxWidth: "420px" }}>
                This is a snapshot. Open the live app to get real-time signals, run a backtest, and track your portfolio.
              </p>
              <Link
                href={`/?symbol=${sym}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  padding: "9px 20px", background: "#0B1F3A", color: "#fff",
                  textDecoration: "none", fontSize: "11px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.12em",
                }}
              >
                <ExternalLink style={{ width: "14px", height: "14px" }} />
                Open Live Analysis
              </Link>
            </div>

            <p style={{ fontSize: "10px", color: "#A8A09A", textAlign: "center" }}>
              Not financial advice. Past performance does not guarantee future results.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
