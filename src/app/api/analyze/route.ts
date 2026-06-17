import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";

  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/analyze?symbol=${encodeURIComponent(symbol)}&period=${period}`,
      { signal: AbortSignal.timeout(9_500) }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err?.name === "TimeoutError" ? "timeout" : String(err);
    return NextResponse.json(
      { error: msg, target: `${PYTHON_BASE}/api/analyze` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
