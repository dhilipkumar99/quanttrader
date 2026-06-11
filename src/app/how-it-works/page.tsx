import Link from "next/link";
import { BarChart2, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How It Works – QuantTrader",
  description: "Step-by-step explanation of the QuantTrader AI analysis pipeline.",
};

const STEPS = [
  {
    n: "01",
    title: "You enter a stock ticker",
    body: "Type any US stock symbol (AAPL, TSLA, NVDA…) into the search bar. QuantTrader fetches live price data directly from Yahoo Finance.",
  },
  {
    n: "02",
    title: "The market regime is detected",
    body: "We measure the Hurst Exponent — a mathematical measure of how 'trendy' vs. 'mean-reverting' a stock is. Combined with volatility (ATR), this categorises the market into one of five regimes: Trending Up, Trending Down, Mean Reverting, Volatile, or Quiet.",
  },
  {
    n: "03",
    title: "Four independent signals are generated",
    body: "Mean Reversion (Bollinger %B + RSI), Trend Following (triple EMA + MACD), Momentum (Jegadeesh-Titman 12-1 strategy), and an ML Ensemble (Gradient Boosted Machine trained on 14 features). Each signal votes buy, sell, or neutral.",
  },
  {
    n: "04",
    title: "Signals are weighted by regime",
    body: "The regime determines which signals get more weight. In a trending market, trend-following signals dominate. In a mean-reverting market, mean-reversion signals lead. This adaptive weighting is key to performance.",
  },
  {
    n: "05",
    title: "Position size is calculated with Kelly Criterion",
    body: "The Half-Kelly formula (f* = (bp - q)/b × 0.5) calculates exactly how much of your portfolio to risk. If tail risk (CVaR) is too high, the position is halved automatically. Max position size is capped at 25% of portfolio.",
  },
  {
    n: "06",
    title: "Monte Carlo simulation runs 500 future scenarios",
    body: "Rather than assuming returns are normally distributed (they're not), we bootstrap from actual historical returns to simulate 500 possible 21-day futures. This gives you a realistic probability of profit and worst-case drawdown.",
  },
  {
    n: "07",
    title: "You see the result + plain-English explanation",
    body: "The composite signal, confidence, indicators, and risk metrics are displayed. Beginners see the 'What does this mean for me?' explainer. Advanced users see the raw quant rationale.",
  },
  {
    n: "08",
    title: "Optionally, paper trade to validate",
    body: "Switch to the Paper Simulator tab to run a full historical backtest. The simulator models realistic slippage (ADV-normalised, IB-style commission) so results are trustworthy, not overfitted.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <BarChart2 className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold text-zinc-100">QuantTrader</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to app
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <section className="text-center space-y-3">
          <h1 className="text-4xl font-black text-zinc-100">How It Works</h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
            From ticker symbol to trade signal — here's every step the AI takes.
          </p>
        </section>

        <div className="space-y-0">
          {STEPS.map((step, i) => (
            <div key={step.n} className="flex gap-5">
              {/* Timeline */}
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-indigo-400">{step.n}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-px flex-1 bg-zinc-800/60 my-1" />
                )}
              </div>

              {/* Content */}
              <div className={`pb-8 ${i === STEPS.length - 1 ? "pb-0" : ""}`}>
                <h2 className="font-bold text-zinc-100 mb-1.5">{step.title}</h2>
                <p className="text-sm text-zinc-400 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 space-y-2">
          <h2 className="font-bold text-indigo-300">Still have questions?</h2>
          <p className="text-sm text-zinc-400">
            Check the <Link href="/glossary" className="text-indigo-400 hover:underline">Glossary</Link> for
            definitions of all the terms, or <Link href="/" className="text-indigo-400 hover:underline">try the app</Link> with
            a ticker you know.
          </p>
        </div>
      </main>
    </div>
  );
}
