import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "AAPL";
  const period = searchParams.get("period") ?? "1y";
  const cash   = searchParams.get("cash")   ?? "100000";

  const projectRoot = path.join(process.cwd());
  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", [
      "-c",
      `
import sys, json
sys.path.insert(0, '${projectRoot}')
from api.quant.simulator import PaperTrader
from api.quant.data import fetch

symbol = '${symbol}'.upper()
period = '${period}'
cash   = float('${cash}')

df = fetch(symbol, period=period, interval='1d')
if df.empty:
    print(json.dumps({'error': 'no_data', 'symbol': symbol}))
    sys.exit(0)

trader = PaperTrader(initial_cash=cash)
stats  = trader.run_backtest(df, symbol)
print(json.dumps(stats))
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
