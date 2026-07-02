import Link from "next/link";
import { BarChart2, ArrowLeft, Shield, Zap, Brain, TrendingUp } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Learn – QuantTrader",
  description: "How QuantTrader works, what every signal means, and a plain-English glossary. No finance degree required.",
};

const STEPS = [
  {
    n: "01",
    title: "You search for a stock",
    body: "Type any US stock symbol (AAPL, TSLA, NVDA…) into the search bar. QuantTrader fetches live price and market data instantly.",
  },
  {
    n: "02",
    title: "We read the market's mood",
    body: "The AI measures the stock's recent behaviour — is it trending steadily upward? Bouncing up and down? Unusually volatile? This 'market mood' tells us which type of analysis to trust most.",
  },
  {
    n: "03",
    title: "Four independent AI models analyse the stock",
    body: "A mean-reversion model (catches bounce-backs), a trend-following model (rides sustained moves), a momentum model (winners keep winning), and a machine learning model trained on years of price data. Each one votes: Buy, Sell, or Stay Out.",
  },
  {
    n: "04",
    title: "The votes are combined into one clear signal",
    body: "The AI weighs each vote based on the current market mood. In a strong uptrend, trend signals count more. In a bouncy sideways market, the bounce-back signals lead. The result: one clear Buy, Sell, or Hold — plus a confidence score.",
  },
  {
    n: "05",
    title: "We calculate exactly how much to invest",
    body: "A mathematical formula called Kelly Criterion works out the ideal fraction of your account to put in this trade. It's designed to grow your money fastest while protecting against big losses. If the math says 0%, we say: skip the trade.",
  },
  {
    n: "06",
    title: "We run 500 simulated futures",
    body: "Rather than guessing how the trade will go, we simulate 500 different possible outcomes based on how the stock has behaved historically. This gives you a realistic win probability — not just hope.",
  },
  {
    n: "07",
    title: "You see your complete trading plan",
    body: "You get the signal, your confidence level, an exact entry price, a stop-loss price (to limit your downside), a target price (to lock in gains), and a dollar amount to invest — all in plain English.",
  },
  {
    n: "08",
    title: "Test it before you use real money",
    body: "Head to Portfolio → Backtest to see how the strategy performed historically. The simulator accounts for realistic trading costs so you get an honest picture.",
  },
];

const TERMS = [
  { term: "Signal", def: "The AI's recommendation: Buy, Sell, or Hold. Think of it like a traffic light — green means the AI sees a buying opportunity, red means avoid or exit, yellow means the models can't agree so stay out." },
  { term: "Confidence", def: "How sure the AI is about its signal, shown as a percentage. 90% confidence means the four AI models are strongly agreeing. 55% means they're barely agreeing — treat it with more caution. Below 60%, we recommend sizing small or waiting." },
  { term: "Market Regime", def: "The current 'mood' of the stock — is it trending steadily upward, falling, bouncing between a range, or unusually volatile? Knowing the regime tells the AI which type of analysis to trust most." },
  { term: "Hurst Exponent", def: "A number measuring whether a stock is trending (goes up, keeps going up) or bouncy (goes up, comes back down). Above 0.6 = trending. Below 0.4 = bouncy. Around 0.5 = unpredictable. QuantTrader uses this to decide which strategy to apply." },
  { term: "Mean Reversion", def: "The idea that prices tend to snap back toward their average after moving too far away. Like a rubber band — the more it stretches, the harder it snaps back. QuantTrader's mean-reversion model spots these stretch-and-snap moments." },
  { term: "Momentum", def: "The 'winners keep winning' effect. Stocks that have been going up for the past year tend to keep going up for the next few months. QuantTrader's momentum model looks for these sustained winners." },
  { term: "RSI (Relative Strength Index)", def: "A 0–100 score measuring if a stock has been bought too much (overbought) or sold too much (oversold). Above 70 = overbought, likely to pull back. Below 30 = oversold, likely to bounce. Think of it as a thermometer for market excitement." },
  { term: "Bollinger Bands", def: "A price channel drawn around a stock's average price. When the price hits the top of the channel, it may be overbought. When it hits the bottom, it may be oversold. The %B value shows where inside the channel the price currently sits." },
  { term: "MACD", def: "A trend indicator that compares two moving averages to spot momentum shifts. When the MACD line crosses above its signal line, that's typically bullish. When it crosses below, it's bearish. One of the most widely used indicators in trading." },
  { term: "EMA (Exponential Moving Average)", def: "An average of a stock's recent prices that gives more weight to recent days. When a fast EMA (like 8-day) crosses above a slower one (like 21-day), the trend is accelerating upward. When it crosses below, momentum is fading." },
  { term: "ATR (Average True Range)", def: "How many dollars (as a %) the stock moves on a typical day. High ATR = big swings, volatile. Low ATR = small moves, calm. QuantTrader uses ATR to set your stop-loss distance — wider stop in volatile stocks, tighter in calm ones." },
  { term: "Kelly Criterion", def: "A mathematical formula that tells you the ideal percentage of your account to put into one trade. Invest too little and you grow too slowly. Invest too much and one bad trade can wipe you out. Kelly finds the mathematical sweet spot. QuantTrader uses half-Kelly for extra safety." },
  { term: "Position Size", def: "How much of your account to invest in a single trade, shown as a % and in dollars. This comes from the Kelly formula. Never invest more than the suggested position size — bigger is not smarter, it's just riskier." },
  { term: "Stop-Loss", def: "A price level you set in your broker that automatically sells your stock if it falls too far. It's your safety net — it limits how much you can lose on a bad trade. Never enter a trade without one." },
  { term: "Take Profit", def: "A target price where you plan to sell and lock in your gains. Setting this before entering a trade stops you from getting greedy and giving back your profits." },
  { term: "Win Probability", def: "QuantTrader's estimate of how likely this trade is to be profitable, based on 500 simulated future scenarios. 70% means 70 out of 100 similar situations ended in a gain. Not a guarantee — just the best statistical estimate." },
  { term: "Monte Carlo Simulation", def: "A way of simulating 500 different possible futures for a stock, based on how it has historically behaved. Instead of guessing, we count how many of those 500 futures end in profit. QuantTrader does this for every trade recommendation." },
  { term: "Drawdown", def: "The percentage drop from a portfolio's highest point to its lowest point before it recovered. A 20% drawdown means the portfolio fell 20% from its peak before bouncing back. Smaller drawdowns = smoother ride." },
  { term: "Sharpe Ratio", def: "A score for how good a strategy's returns are relative to its risk. Above 1.0 is good. Above 2.0 is excellent. If two strategies have the same returns, the one with less volatility gets a higher Sharpe — because smoother is better." },
  { term: "Sortino Ratio", def: "Like the Sharpe Ratio, but only penalises downward moves. If your strategy occasionally spikes up but rarely crashes down, the Sortino captures that better than the Sharpe. Higher is better." },
  { term: "Slippage", def: "When you place a buy order, you often end up paying slightly more than the price you saw. In fast markets, your order fills at a worse price than expected. This friction is called slippage — QuantTrader models it in all backtests." },
  { term: "Backtest", def: "Running a trading strategy against real historical data to see how it would have performed. QuantTrader's backtester shows wins, losses, drawdowns, and returns on past data — so you can evaluate a strategy before risking real money." },
  { term: "Walk-Forward Validation", def: "A more honest way of backtesting. Instead of training the AI on all historical data and then testing it on the same data (which would be cheating), walk-forward validation only ever tests on data the AI has never seen before. This gives more realistic performance estimates." },
  { term: "AI / Machine Learning Model", def: "QuantTrader's AI model learns patterns from years of stock price data. It analyses 14 different price and volume features and outputs a Buy/Sell/Neutral recommendation. It fires only when it's at least 62% confident — otherwise it stays quiet." },
  { term: "Volume / ADV", def: "ADV stands for Average Daily Volume — how many shares of a stock typically trade each day. If today's volume is 2× ADV, unusually many people are trading. High volume usually means a signal is stronger and orders will fill more easily." },
  { term: "VaR & CVaR", def: "VaR (Value at Risk) is your estimated maximum loss at a certain confidence level. CVaR is the average loss in the worst scenarios. QuantTrader automatically halves the suggested position size if CVaR is dangerously high — protecting you without you having to do the math." },
];

export default function LearnPage() {
  const sorted = [...TERMS].sort((a, b) => a.term.localeCompare(b.term));
  const letters = [...new Set(sorted.map(t => t.term[0]))];

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
          <nav className="flex items-center gap-4 text-xs text-zinc-500">
            <a href="#about"       className="hover:text-zinc-200 transition-colors">About</a>
            <a href="#how-it-works" className="hover:text-zinc-200 transition-colors">How It Works</a>
            <a href="#glossary"    className="hover:text-zinc-200 transition-colors">Glossary</a>
            <Link href="/" className="flex items-center gap-1 hover:text-zinc-200 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to app
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-20">

        {/* ── About ── */}
        <section id="about" className="space-y-8">
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-black text-zinc-100">About QuantTrader</h1>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              The AI trading assistant that tells you exactly what to buy, how much to invest, and when to exit — in plain English. No finance degree needed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Brain, title: "Four AI Models, One Clear Signal", body: "Four independent AI models each analyse the stock from a different angle. Their votes are combined into a single Buy / Sell / Hold signal with a confidence score, so you always know how much to trust the recommendation." },
              { icon: Shield, title: "Your Money Is Protected First", body: "Before calculating how much to invest, the system runs a safety check. If the risk is too high, it says skip the trade or invest less. You'll never be told to bet the house on a weak signal." },
              { icon: Zap, title: "Live Market Data", body: "Prices, signals, and indicators update from live market data, so the analysis reflects what's happening right now — not yesterday's news." },
              { icon: TrendingUp, title: "Test Before You Risk Real Money", body: "Run any strategy against years of real historical data before investing a single dollar. See what would have happened — wins, losses, drawdowns, everything." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-indigo-400" />
                  <h2 className="font-bold text-zinc-100">{title}</h2>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-6 space-y-3">
            <h2 className="text-xl font-bold text-zinc-100">Why QuantTrader Is Different</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Most trading apps are just chart-drawing tools — they show you a pretty line and leave you to figure out what it means. QuantTrader goes further: it tells you what the signal means, what to do about it, how much to invest, and where to set your stop-loss. The same type of analysis used by professional trading firms, made accessible to everyone.
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              <strong className="text-zinc-200">Important:</strong> QuantTrader is an analysis and education tool, not a financial advisor. Always do your own research and only trade with money you can afford to lose.
            </p>
          </div>
        </section>

        <div className="border-t border-zinc-800/60" />

        {/* ── How It Works ── */}
        <section id="how-it-works" className="space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-4xl font-black text-zinc-100">How It Works</h2>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              From typing a stock symbol to getting your complete trading plan — here&apos;s every step the AI takes, in plain English.
            </p>
          </div>

          <div className="space-y-0">
            {STEPS.map((step, i) => (
              <div key={step.n} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="h-10 w-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-indigo-400">{step.n}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className="w-px flex-1 bg-zinc-800/60 my-1" />}
                </div>
                <div className={`pb-8 ${i === STEPS.length - 1 ? "pb-0" : ""}`}>
                  <h3 className="font-bold text-zinc-100 mb-1.5">{step.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="border-t border-zinc-800/60" />

        {/* ── Glossary ── */}
        <section id="glossary" className="space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-4xl font-black text-zinc-100">What Does That Mean?</h2>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Plain-English definitions for every term you&apos;ll see in QuantTrader. Bookmark this page — it&apos;s your trading dictionary.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {letters.map(l => (
              <a
                key={l}
                href={`#letter-${l}`}
                className="px-2 py-1 rounded bg-zinc-800/60 border border-zinc-700/30 text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                {l}
              </a>
            ))}
          </div>

          {letters.map(letter => (
            <div key={letter} id={`letter-${letter}`}>
              <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3 border-b border-zinc-800/60 pb-1">
                {letter}
              </div>
              <dl className="space-y-4">
                {sorted.filter(t => t.term[0] === letter).map(({ term, def }) => (
                  <div key={term}>
                    <dt className="font-bold text-zinc-200 mb-0.5">{term}</dt>
                    <dd className="text-sm text-zinc-400 leading-relaxed">{def}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>

        <div className="text-center pt-4 space-y-3">
          <p className="text-zinc-400 text-sm">Ready to put this into practice?</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
          >
            <BarChart2 className="h-4 w-4" />
            Find Your Next Trade
          </Link>
        </div>
      </main>
    </div>
  );
}
