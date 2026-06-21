import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

async function fetchCandles(symbol: string, period: string): Promise<Response> {
  return fetch(
    `${PYTHON_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&period=${period}`,
    { signal: AbortSignal.timeout(8_500) }
  );
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";

  try {
    let res = await fetchCandles(symbol, period);

    // 503 means Render is computing in background — wait briefly and retry once
    if (res.status === 503) {
      await new Promise(r => setTimeout(r, 1_000));
      try {
        res = await fetchCandles(symbol, period);
      } catch { /* fall through with the 503 */ }
    }

    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: res.ok
        ? { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" }
        : { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
