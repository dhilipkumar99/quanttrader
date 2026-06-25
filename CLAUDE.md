# QuantTrader — Architecture Overview

## Stack
- **Frontend**: Next.js 15 App Router (TypeScript), Tailwind CSS, Zustand (persisted store), Recharts/SVG charts
- **Backend**: FastAPI (`api/server.py`, port 8787 in dev), deployed as Vercel Python serverless functions
- **Data**: Yahoo Finance (primary via `yfinance`), TwelveData (secondary; SQLite cache in `api/quant/ohlcv_store.py`)
- **Broker**: Alpaca (`api/quant/broker.py`) — paper trading default; live requires `ALPACA_LIVE=true`

## Quant Engine
- Entry point: `api/quant/engine.py` → `QuantEngine.analyze(symbol, period, horizon)` returns `QuantResult`
- ML model: GradientBoostingClassifier trained on 40+ technical features; walk-forward CV via TimeSeriesSplit
- Signals: regime detection, RSI, MACD, Bollinger, volume, VWAP, Kelly sizing, Monte Carlo paths
- `beginner_summary: str` field on `QuantResult` — one plain-English sentence, always populated

## Agent System
- `api/quant/agent.py` — `AgentLoop` singleton; runs in background daemon thread; state persisted to `agent_state.json`
- `api/quant/intraday_agent.py` — FSM (WAITING → IN_POSITION → SCALE_OUT → CLOSED); 1-min bar polling
- `api/quant/circuit_breaker.py` — cross-agent equity drawdown halt; JSON sidecar state; Resend → SMTP email
- Email: Resend HTTP API (`RESEND_API_KEY`) → SMTP fallback; all sends in daemon threads; never raises

## Data Flow
```
Browser → Next.js /app/api/* (proxy routes) → FastAPI api/server.py → QuantEngine / Broker / OHLCV store
```
- Next.js routes in `src/app/api/` are thin proxies forwarding to `PYTHON_API_BASE` (default: `http://localhost:8787`)
- Catch-all routes use `[...path]/route.ts` pattern; always forward `req.nextUrl.search` for query strings

## UI Structure
- `src/app/page.tsx` — root shell; tab routing; keyboard shortcuts; `KeyboardShortcuts` component
- `src/components/ui/Sidebar.tsx` — `NAV_ITEMS` array drives tab list + keyboard hint labels
- `src/store/trader.ts` — Zustand store; persisted fields: `pinnedSymbols`, `activeSymbol`, `activePeriod`, `paperCash`, `portfolioEntries`, `portfolioCapital`, `beginnerMode`, `onboarding`
- Beginner mode: `beginnerMode` flag in store; `BeginnerModeView.tsx` for analysis tab, `SimplifiedDashboard.tsx` for picks tab
- `src/lib/api.ts` — typed API client; all frontend→backend calls go through here

## Environment Variables (`.env.local`)
```
TWELVE_DATA_API_KEY=...      # TwelveData price data (800 calls/day budget)
ALPACA_API_KEY=...           # Alpaca paper/live broker
ALPACA_SECRET_KEY=...
ALPACA_LIVE=false            # set true for live trading
RESEND_API_KEY=...           # email notifications
PYTHON_API_BASE=http://localhost:8787  # Next.js → FastAPI proxy target
```

## Local Dev
```bash
# Terminal 1 — Python API
pip install -r requirements-render.txt
python api/server.py

# Terminal 2 — Next.js
npm install
npm run dev
```
