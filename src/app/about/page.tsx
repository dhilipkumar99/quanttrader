import Link from "next/link";
import { BarChart2, ArrowLeft, Shield, Zap, Brain, TrendingUp } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About – QuantTrader",
  description: "Learn how QuantTrader's ML-powered quant engine works and what makes it different.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
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

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-12">
        <section className="text-center space-y-3">
          <h1 className="text-4xl font-black text-zinc-100">About QuantTrader</h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
            An open-source, institutional-grade quant trading platform powered by machine learning —
            built for everyone from beginners to professional traders.
          </p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              icon: Brain,
              title: "Machine Learning Core",
              body: "A Gradient Boosted Machine ensemble trained with walk-forward validation learns from 14 price and volume features to produce high-confidence trade signals.",
            },
            {
              icon: Shield,
              title: "Risk-First Design",
              body: "Half-Kelly criterion position sizing and a CVaR gate mean the system never bets more than the math justifies. Your capital is protected first, returns second.",
            },
            {
              icon: Zap,
              title: "Real-Time Data",
              body: "Prices and indicators refresh directly from Yahoo Finance, giving you accurate, up-to-date analysis on thousands of tickers.",
            },
            {
              icon: TrendingUp,
              title: "Paper Simulator",
              body: "Test every strategy on real historical data before committing a single dollar. See realistic slippage, commissions, drawdowns, and win rates.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-indigo-400" />
                <h2 className="font-bold text-zinc-100">{title}</h2>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-6 space-y-3">
          <h2 className="text-xl font-bold text-zinc-100">How We're Different</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Most retail trading tools are glorified chart-drawing apps. QuantTrader brings institutional quant research
            methodologies — regime detection, bootstrap Monte Carlo simulation, ADV-normalised slippage — to retail investors.
            Every design decision traces back to peer-reviewed quant finance literature, not gut feeling.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            <strong className="text-zinc-200">We do not manage money.</strong> We provide analysis tools only.
            Always consult a licensed financial advisor before making investment decisions.
          </p>
        </section>

        <section className="text-center space-y-3">
          <h2 className="text-xl font-bold text-zinc-100">Ready to dive in?</h2>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
          >
            <BarChart2 className="h-4 w-4" />
            Open the App
          </Link>
        </section>
      </main>
    </div>
  );
}
