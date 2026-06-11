import { Metadata } from "next";
import Link from "next/link";
import { BarChart2, ArrowLeft, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ symbol: string }>;
}

// Fetch from the Python engine at build/request time (ISR)
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

const SIGNAL_LABEL: Record<number, string> = { 1: "LONG ▲", "-1": "SHORT ▼", 0: "FLAT ■" };
const SIGNAL_COLOR: Record<number, string> = {
  1: "text-emerald-400", "-1": "text-rose-400", 0: "text-zinc-400"
};
const REGIME_COLOR: Record<string, string> = {
  trending_up: "text-emerald-400", trending_down: "text-rose-400",
  mean_reverting: "text-amber-400", volatile: "text-orange-400", quiet: "text-zinc-400",
};

export default async function AnalysisSharePage({ params }: Props) {
  const { symbol } = await params;
  const sym  = symbol.toUpperCase();
  const data = await getAnalysis(sym);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <BarChart2 className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold text-zinc-100">QuantTrader</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Live App
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {!data ? (
          <div className="text-center py-20 space-y-3">
            <div className="text-zinc-600 text-4xl font-black">{sym}</div>
            <p className="text-zinc-500">Could not load analysis. The market may be closed or the ticker invalid.</p>
            <Link href={`/?symbol=${sym}`} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold mt-2">
              Try in Live App
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/60 p-6 space-y-1">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">QuantTrader AI Analysis</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-3xl font-black text-zinc-100">{data.symbol}</h1>
                <span className="text-2xl font-bold text-zinc-200">${data.price?.toFixed(2)}</span>
                <span className={cn("text-sm font-semibold", data.change_pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {data.change_pct >= 0 ? "+" : ""}{data.change_pct?.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center gap-4 mt-3">
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Signal</div>
                  <div className={cn("text-2xl font-black", SIGNAL_COLOR[data.composite_signal])}>
                    {SIGNAL_LABEL[data.composite_signal] ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Confidence</div>
                  <div className="text-xl font-bold text-zinc-200">
                    {((data.composite_confidence ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Regime</div>
                  <div className={cn("text-sm font-semibold capitalize", REGIME_COLOR[data.regime] ?? "text-zinc-400")}>
                    {data.regime?.replace(/_/g, " ")}
                  </div>
                </div>
              </div>
            </div>

            {/* Risk grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Sharpe", value: data.risk_metrics?.sharpe?.toFixed(2) },
                { label: "Sortino", value: data.risk_metrics?.sortino?.toFixed(2) },
                { label: "MC Profit%", value: `${data.monte_carlo?.prob_positive}%` },
                { label: "Kelly Size", value: `${data.position_size_pct}%` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</div>
                  <div className="text-lg font-bold text-zinc-200 mt-0.5">{value ?? "—"}</div>
                </div>
              ))}
            </div>

            {/* Sub signals */}
            {data.signals?.length > 0 && (
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4 space-y-2">
                <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Sub-Signals</div>
                {data.signals.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-zinc-800/40 last:border-0">
                    <span className="text-zinc-400 capitalize">{s.source?.replace(/_/g, " ")}</span>
                    <span className={cn("font-bold", s.direction === 1 ? "text-emerald-400" : s.direction === -1 ? "text-rose-400" : "text-zinc-400")}>
                      {s.direction === 1 ? "▲ LONG" : s.direction === -1 ? "▼ SHORT" : "■ FLAT"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center space-y-3">
              <p className="text-sm text-zinc-400">
                This is a snapshot. Open the live app to get real-time signals, run a backtest, and track your portfolio.
              </p>
              <Link
                href={`/?symbol=${sym}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
              >
                <ExternalLink className="h-4 w-4" />
                Open Live Analysis
              </Link>
            </div>

            <p className="text-[10px] text-zinc-700 text-center">
              Not financial advice. Past performance does not guarantee future results.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
