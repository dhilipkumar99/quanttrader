import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

const DEFAULT_SYMBOLS = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN",
  "META","TSLA","JPM","V","UNH",
  "SPY","QQQ","BRK-B","JNJ","XOM",
];

const root = path.join(process.cwd());

function analyzeOne(sym: string): Promise<object | null> {
  return new Promise((resolve) => {
    const py = spawn("python3", ["-c", `
import sys, json
sys.path.insert(0, '${root}')
from api.quant.engine import QuantEngine
from api.quant.data import fetch, fetch_quote
engine = QuantEngine()
sym = '${sym}'
df = fetch(sym, period='6mo', interval='1d')
if df.empty:
    print('null')
    sys.exit(0)
r     = engine.analyze(df, sym)
quote = fetch_quote(sym)
print(json.dumps({
    'symbol':     sym,
    'price':      quote.get('price', 0),
    'change_pct': quote.get('change_pct', 0),
    'signal':     r.composite_signal,
    'confidence': r.composite_confidence,
    'regime':     r.regime,
    'rsi':        r.indicators.get('rsi_14', 50),
    'sharpe':     r.risk_metrics.get('sharpe', 0),
    'kelly_pct':  r.position_size_pct,
}))
`], { env: { ...process.env } });

    let out = "";
    py.stdout.on("data", (d) => { out += d; });
    py.on("close", () => {
      try {
        const v = JSON.parse(out.trim());
        resolve(v ?? null);
      } catch {
        resolve(null);
      }
    });
    // Kill straggler processes after 40s
    setTimeout(() => { py.kill(); resolve(null); }, 40_000);
  });
}

export async function GET(req: NextRequest) {
  const raw     = req.nextUrl.searchParams.get("symbols");
  const symbols = raw
    ? raw.split(",").map(s => s.trim().toUpperCase()).slice(0, 20)
    : DEFAULT_SYMBOLS;

  // Run all analyses concurrently — 5-10× faster than sequential
  const results = await Promise.all(symbols.map(analyzeOne));
  const watchlist = results
    .filter(Boolean)
    .sort((a: any, b: any) => Math.abs(b.confidence) * Math.abs(b.signal) - Math.abs(a.confidence) * Math.abs(a.signal));

  return NextResponse.json({ watchlist });
}
