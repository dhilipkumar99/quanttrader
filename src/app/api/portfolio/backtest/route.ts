import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols") ?? "AAPL,MSFT";
  const period  = req.nextUrl.searchParams.get("period")  ?? "1y";
  const cash    = req.nextUrl.searchParams.get("cash")    ?? "100000";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/portfolio/backtest?symbols=${encodeURIComponent(symbols)}&period=${period}&cash=${cash}`,
      { signal: AbortSignal.timeout(120_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
