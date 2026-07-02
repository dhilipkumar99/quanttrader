import Link from "next/link";
import { BarChart2, ArrowLeft, Shield, Zap, Brain, TrendingUp } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About – QuantTrader",
  description: "QuantTrader gives every trader AI-powered buy/sell signals with plain-English explanations — no finance degree required.",
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
            We believe every trader — beginner or experienced — deserves the same tools that professional trading firms use. So we built them, made them easy to understand, and made them free.
          </p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              icon: Brain,
              title: "Four AI Models, One Clear Signal",
              body: "Four independent AI models each analyse the stock from a different angle. Their votes are combined into one clear Buy / Sell / Hold signal — with a confidence score so you know how strongly the AI believes it.",
            },
            {
              icon: Shield,
              title: "Built to Protect Your Money",
              body: "Before showing you how much to invest, the system checks risk first. If the math says the trade is too risky, it tells you to skip or size down. Your capital is protected before returns are considered.",
            },
            {
              icon: Zap,
              title: "Live Market Data",
              body: "Signals update from live market data so you're always working with what's happening right now, not yesterday's stale information.",
            },
            {
              icon: TrendingUp,
              title: "Test Before You Risk Real Money",
              body: "Run any strategy against years of real historical data. See wins, losses, drawdowns, and returns — so you build confidence before trading with real capital.",
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
          <h2 className="text-xl font-bold text-zinc-100">Why QuantTrader Is Different</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Most trading apps show you charts and leave you to figure out what they mean. QuantTrader goes further: it tells you what the signal means, what to do about it, exactly how much to invest, and where to put your stop-loss. The same rigorous analysis used by professional quant funds, translated into plain English for everyone.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            <strong className="text-zinc-200">Important:</strong> QuantTrader is an analysis and education tool, not a licensed financial advisor. Always do your own research and never trade more than you can afford to lose.
          </p>
        </section>

        <section className="text-center space-y-3">
          <h2 className="text-xl font-bold text-zinc-100">Ready to find your next trade?</h2>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
          >
            <BarChart2 className="h-4 w-4" />
            Open QuantTrader
          </Link>
        </section>
      </main>
    </div>
  );
}
