import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols") ?? "AAPL,MSFT";
  const period  = req.nextUrl.searchParams.get("period")  ?? "1y";
  const cash    = req.nextUrl.searchParams.get("cash")    ?? "100000";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/portfolio/backtest?symbols=${encodeURIComponent(symbols)}&period=${period}&cash=${cash}`,
      { signal: AbortSignal.timeout(9_500) }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=7200" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
