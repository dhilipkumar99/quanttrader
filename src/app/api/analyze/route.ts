import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

// Run Python quant engine inline via child process.
// In production (Vercel), the Python serverless functions in /api/analyze.py handle requests directly.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "AAPL";
  const period = searchParams.get("period") ?? "1y";

  return runPythonScript("analyze", { symbol, period });
}

async function runPythonScript(script: string, args: Record<string, string>): Promise<NextResponse> {
  const projectRoot = path.join(process.cwd());

  return new Promise((resolve) => {
    const argStr = Object.entries(args).map(([k, v]) => `${k}=${v}`).join("&");
    const py = spawn("python3", [
      "-c",
      `
import sys, json
sys.path.insert(0, '${projectRoot}')
from api.quant.engine import QuantEngine
from api.quant.data import fetch, fetch_quote

engine = QuantEngine()
params = dict(p.split('=') for p in '${argStr}'.split('&'))
symbol = params.get('symbol', 'AAPL').upper()
period = params.get('period', '1y')

df = fetch(symbol, period=period, interval='1d')
if df.empty:
    print(json.dumps({'error': 'no_data', 'symbol': symbol}))
    sys.exit(0)

result = engine.analyze(df, symbol)
quote  = fetch_quote(symbol)

payload = {
    'symbol': result.symbol,
    'price': quote.get('price', 0),
    'change_pct': quote.get('change_pct', 0),
    'composite_signal': result.composite_signal,
    'composite_confidence': result.composite_confidence,
    'regime': result.regime,
    'position_size_pct': result.position_size_pct,
    'expected_return': result.expected_return,
    'risk_metrics': result.risk_metrics,
    'indicators': result.indicators,
    'monte_carlo': result.monte_carlo,
    'signals': [
        {'source': s.source, 'direction': s.direction, 'confidence': round(s.confidence, 4),
         'stop_loss': round(s.stop_loss, 4), 'take_profit': round(s.take_profit, 4)}
        for s in result.signals
    ],
}
print(json.dumps(payload))
`
    ], { env: { ...process.env } });

    let out = "";
    let err = "";
    py.stdout.on("data", (d) => { out += d.toString(); });
    py.stderr.on("data", (d) => { err += d.toString(); });
    py.on("close", () => {
      try {
        const data = JSON.parse(out.trim());
        if (data.error) {
          resolve(NextResponse.json(data, { status: 404 }));
        } else {
          resolve(NextResponse.json(data));
        }
      } catch {
        resolve(NextResponse.json({ error: "parse_error", detail: err.slice(0, 500) }, { status: 500 }));
      }
    });
  });
}
