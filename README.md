# QuantTrader — ML-Powered Systematic Trading Platform

Production-grade quant trading dashboard with regime detection, multi-factor signal generation, Kelly criterion position sizing, and Monte Carlo risk management. Includes a paper trading simulator for model validation before deploying real capital.

## Architecture

```
quanttrader/
├── api/
│   ├── quant/
│   │   ├── engine.py       # Core quant engine (FeatureEngineer, RegimeDetector, 4 signal generators, ML ensemble)
│   │   ├── simulator.py    # Paper trading simulator with walk-forward backtest
│   │   └── data.py         # yfinance data layer with caching + sanity checks
│   ├── analyze.py          # Vercel Python serverless: /api/analyze
│   ├── backtest.py         # Vercel Python serverless: /api/backtest
│   └── watchlist.py        # Vercel Python serverless: /api/watchlist
└── src/
    ├── app/
    │   ├── page.tsx         # Main dashboard
    │   └── api/             # Next.js API routes (local dev via Python subprocess)
    ├── components/
    │   ├── panels/          # SignalPanel, IndicatorsPanel, SimulatorPanel, WatchlistPanel
    │   ├── charts/          # EquityChart, MonteCarloChart, IndicatorGauge
    │   └── ui/              # Card, Badge, Spinner
    ├── store/trader.ts      # Zustand state
    ├── lib/api.ts           # API client
    └── types/quant.ts       # TypeScript types
```

## Quant Methodology (based on QuantBasics.txt — Proof Trading, Feb 2026)

### Features (§5: Data Normalisation)
- 14 ADV-normalised features: RSI, MACD histogram, Bollinger %B, triple EMA spreads
- Hurst exponent via R/S analysis (rolling 40-bar window)
- 12-1 month momentum (Jegadeesh-Titman), ADV volume ratio
- ATR-normalised volatility, HL range relative to ADV

### Regime Detection (§9.3 clustering)
| Regime | Condition | Strategy Weight |
|---|---|---|
| Trending Up | Hurst > 0.6, EMA spread > 0 | Trend x2, Momentum x1.5 |
| Trending Down | Hurst > 0.6, EMA spread < 0 | Trend x2, Momentum x1.5 |
| Mean-Reverting | Hurst < 0.4 | MR x2.5, Trend x0.3 |
| Volatile | ATR > 85th pctile | All x0.3, ML x1.0 |
| Quiet | Otherwise | Balanced |

### Signal Generators (§10.5 decision trees, §10.6 neural nets)
- **MeanReversionSignal**: Bollinger %B < -0.85 + RSI < 35
- **TrendFollowSignal**: EMA 8/21 golden/death cross + MACD confirmation
- **MomentumSignal**: 12-1 month momentum with ADV volume confirmation
- **MLSignal**: GBM ensemble (150 trees, walk-forward CV, no look-ahead per §7.1)

### Position Sizing — Half-Kelly Criterion (§3)
```
f* = (b*p - q) / b  *  0.5  (half-Kelly, capped at 25%)
```
CVaR gate: if 5th-percentile CVaR < -8%, position size is halved.

### Monte Carlo Risk (§7.2)
- 500 bootstrap paths x 21-day horizon
- Bootstrap from empirical return distribution (no Gaussian assumption — §4.4)
- Reports VaR, CVaR, median/worst drawdown, P(positive)

### Paper Simulator
- Walk-forward backtest with 60-bar warm-up (prevents look-ahead)
- ADV-normalised slippage: `slip_bps = max(0.5, participation_rate * 500)`
- Commission: $0.005/share, min $1 (IB-style)

## Validated Results (2026-06-11)

| Symbol | Period | Return | Sharpe | Win Rate | Max DD |
|---|---|---|---|---|---|
| NVDA | 1y, $50k | +13.1% | 2.08 | 78.9% | 2.9% |
| AAPL | 2y, $100k | +2.2% | 0.42 | 60.5% | 2.9% |

## Local Development

```bash
# Install Node deps
npm install

# Install Python deps
pip install -r requirements.txt

# Run dev server
npm run dev -- --port 3001

# Open dashboard
open http://localhost:3001
```

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (Python serverless functions handle /api/*)
vercel --prod
```

The `vercel.json` wires Python serverless functions for the quant API endpoints.
Next.js API routes (`src/app/api/`) are used for local development via subprocess.

## Disclaimer

This software is for educational and research purposes. Past performance of backtests does not guarantee future results. Always validate with paper trading before deploying real capital.
