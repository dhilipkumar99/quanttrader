import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";
  const url = `${PYTHON_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&period=${period}`;

  // Single request with 8.5s timeout — fits inside Vercel's 10s hard kill with margin.
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_500) });
    const data = await res.json();
    if (res.ok) {
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" },
      });
    }
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store", ...(res.status === 503 ? { "Retry-After": "5" } : {}) },
    });
  } catch (e: unknown) {
    const err = e as Error;
    if (err?.name === "TimeoutError") {
      return NextResponse.json(
        { error: "computing", retry_after: 5 },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } }
      );
    }
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
