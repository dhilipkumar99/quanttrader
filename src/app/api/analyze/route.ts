import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";
  const url = `${PYTHON_BASE}/api/analyze?symbol=${encodeURIComponent(symbol)}&period=${period}`;

  // Poll Render up to 3 times within the ~9s Vercel budget.
  // 503 = background compute running; wait 2s and retry.
  // This covers the cache-miss case where yfinance finishes in 3-8s.
  const delays = [0, 2000, 2000]; // attempt 0: immediate, 1: +2s, 2: +2s = 4s max wait
  let lastRes: Response | null = null;

  for (const delay of delays) {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4_500) });
      if (res.status !== 503) {
        // Got a real answer (200, 404, etc.) — return it
        const data = await res.json();
        return NextResponse.json(data, {
          status: res.status,
          headers: res.ok
            ? { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" }
            : { "Cache-Control": "no-store" },
        });
      }
      lastRes = res;
    } catch (e: unknown) {
      const err = e as Error;
      if (err?.name === "TimeoutError") continue; // timed out waiting — try again
      return NextResponse.json(
        { error: String(err) },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  // All retries exhausted — still computing; pass 503 through so client can retry
  if (lastRes) {
    const data = await lastRes.json().catch(() => ({ error: "computing" }));
    return NextResponse.json(data, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "3" },
    });
  }
  return NextResponse.json(
    { error: "timeout" },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}
