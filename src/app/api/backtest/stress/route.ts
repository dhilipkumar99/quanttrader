import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol") ?? "AAPL";
  const period = searchParams.get("period") ?? "5y";
  const cash   = searchParams.get("cash")   ?? "100000";

  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/backtest/stress?symbol=${encodeURIComponent(symbol)}&period=${period}&cash=${cash}`,
      { signal: AbortSignal.timeout(120_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.name === "TimeoutError" ? "timeout" : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
