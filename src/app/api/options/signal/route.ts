import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const p              = req.nextUrl.searchParams;
  const symbol         = p.get("symbol")          ?? "AAPL";
  const horizon        = p.get("horizon")          ?? "day";
  const portfolioValue = p.get("portfolio_value")  ?? "10000";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/options/signal?symbol=${encodeURIComponent(symbol)}&horizon=${encodeURIComponent(horizon)}&portfolio_value=${portfolioValue}`,
      { signal: AbortSignal.timeout(45_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = (e as Error)?.name === "TimeoutError" ? "timeout" : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
