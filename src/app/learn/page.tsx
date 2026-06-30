import Link from "next/link";
import { BarChart2, ArrowLeft, Shield, Zap, Brain, TrendingUp } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Learn – QuantTrader",
  description: "About QuantTrader, how the AI pipeline works, and a plain-English glossary of every term.",
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
    body: "Switch to the Portfolio → Backtest sub-tab to run a full historical backtest. The simulator models realistic slippage (ADV-normalised, IB-style commission) so results are trustworthy, not overfitted.",
  },
];

const TERMS = [
  { term: "Signal", def: "A recommendation from the AI: Buy (go long), Sell (avoid or exit), or Neutral (no clear direction). Think of it like a traffic light — green means go, red means stop, yellow means wait." },
  { term: "Confidence", def: "How strongly the AI believes in the signal, from 0% (totally uncertain) to 100% (very certain). A weak signal at low confidence should be treated with more caution than a strong signal at high confidence." },
  { term: "Regime", def: "The 'personality' of the stock's recent price behaviour. Is it in a persistent trend? Bouncing between a range? Unusually volatile? Knowing the regime helps pick the right strategy." },
  { term: "Hurst Exponent", def: "A number between 0 and 1 measuring market memory. Above 0.6 means the price is trending (momentum). Below 0.4 means it tends to reverse (mean-reverting). Around 0.5 is random (no predictable pattern)." },
  { term: "Mean Reversion", def: "The tendency of prices to snap back toward their average. If a stock falls far below its average, mean reversion says it will likely bounce back." },
  { term: "Momentum", def: "The tendency of recent price trends to continue. If a stock has been rising, momentum says it may keep rising for a while." },
  { term: "RSI (Relative Strength Index)", def: "A measure of how overbought or oversold a stock is on a 0–100 scale. Above 70 is considered overbought (may fall), below 30 is oversold (may rise)." },
  { term: "Bollinger Bands", def: "Price bands plotted 2 standard deviations above and below a moving average. When the price touches the upper band it may be overbought; lower band = oversold." },
  { term: "MACD", def: "Moving Average Convergence Divergence. A popular trend indicator showing the relationship between two moving averages. When the MACD line crosses above the signal line, that's usually a bullish sign." },
  { term: "EMA (Exponential Moving Average)", def: "A moving average that weights recent prices more heavily than older ones. Traders use multiple EMAs (e.g., 9, 21, 55-day) to spot trend direction and crossovers." },
  { term: "ATR (Average True Range)", def: "A measure of how much a stock's price moves on a typical day. High ATR = volatile. Low ATR = calm. Used here to detect volatile market regimes." },
  { term: "Kelly Criterion", def: "A mathematical formula that calculates the optimal fraction of your capital to bet on a trade, based on your edge and the odds. QuantTrader uses Half-Kelly (half the optimal) for safety." },
  { term: "Position Size", def: "How much of your portfolio to allocate to a single trade, expressed as a percentage. The Kelly formula produces this number — never more than 25% in QuantTrader." },
  { term: "Monte Carlo Simulation", def: "Running hundreds or thousands of random but realistic future scenarios to estimate probabilities. QuantTrader runs 500 scenarios over 21 days to estimate your odds of profit." },
  { term: "VaR (Value at Risk)", def: "The maximum expected loss at a given confidence level. '5% VaR of -3%' means there's a 5% chance of losing more than 3% in the time period." },
  { term: "CVaR (Conditional Value at Risk)", def: "The average loss in the worst 5% of scenarios — more informative than VaR alone. If CVaR is very negative (< -8%), QuantTrader halves the position size automatically." },
  { term: "Drawdown", def: "The percentage drop from a portfolio's peak to its lowest point. A 20% drawdown means the portfolio fell 20% from its high before recovering." },
  { term: "Sharpe Ratio", def: "A measure of risk-adjusted return. It divides your return by your volatility. Above 1.0 is considered good, above 2.0 is excellent. A high return with low volatility = high Sharpe." },
  { term: "Sortino Ratio", def: "Like the Sharpe Ratio, but only penalises downside volatility (bad moves). A more forgiving measure — good strategies that occasionally spike up get a better Sortino than Sharpe." },
  { term: "Slippage", def: "The difference between the price you expected to trade at and the price you actually got. In a fast-moving market, your buy order might fill slightly higher than planned. Measured in basis points (bps)." },
  { term: "Basis Points (bps)", def: "1 basis point = 0.01%. So 50 bps slippage means you paid 0.5% more than expected. Common unit for small price differences in finance." },
  { term: "Walk-Forward Validation", def: "A backtesting method where the ML model is only trained on data before each trade, never on future data. This prevents 'cheating' and makes results more realistic." },
  { term: "GBM / Gradient Boosted Machine", def: "A powerful machine learning algorithm that builds hundreds of decision trees, each one correcting the errors of the last. One of the most effective ML methods for financial prediction." },
  { term: "ADV (Average Daily Volume)", def: "How many shares of a stock typically trade each day. QuantTrader normalises signals and slippage by ADV — a large order in a low-volume stock creates more slippage." },
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
              An institutional-grade quant trading platform powered by machine learning —
              built for everyone from beginners to professional traders.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Brain, title: "Machine Learning Core", body: "A Gradient Boosted Machine ensemble trained with walk-forward validation learns from 14 price and volume features to produce high-confidence trade signals." },
              { icon: Shield, title: "Risk-First Design", body: "Half-Kelly criterion position sizing and a CVaR gate mean the system never bets more than the math justifies. Your capital is protected first, returns second." },
              { icon: Zap, title: "Real-Time Data", body: "Prices and indicators refresh directly from Yahoo Finance, giving you accurate, up-to-date analysis on thousands of tickers." },
              { icon: TrendingUp, title: "Paper Simulator", body: "Test every strategy on real historical data before committing a single dollar. See realistic slippage, commissions, drawdowns, and win rates." },
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
            <h2 className="text-xl font-bold text-zinc-100">How We&apos;re Different</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Most retail trading tools are glorified chart-drawing apps. QuantTrader brings institutional quant research
              methodologies — regime detection, bootstrap Monte Carlo simulation, ADV-normalised slippage — to retail investors.
              Every design decision traces back to peer-reviewed quant finance literature, not gut feeling.
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              <strong className="text-zinc-200">We do not manage money.</strong> We provide analysis tools only.
              Always consult a licensed financial advisor before making investment decisions.
            </p>
          </div>
        </section>

        <div className="border-t border-zinc-800/60" />

        {/* ── How It Works ── */}
        <section id="how-it-works" className="space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-4xl font-black text-zinc-100">How It Works</h2>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              From ticker symbol to trade signal — here&apos;s every step the AI takes.
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
            <h2 className="text-4xl font-black text-zinc-100">Glossary</h2>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Plain-English definitions for every term used in QuantTrader. No finance degree required.
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

        <div className="text-center pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
          >
            <BarChart2 className="h-4 w-4" />
            Back to the App
          </Link>
        </div>
      </main>
    </div>
  );
}
