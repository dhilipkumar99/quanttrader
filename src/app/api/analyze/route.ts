import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";

  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/analyze?symbol=${encodeURIComponent(symbol)}&period=${period}`,
      { signal: AbortSignal.timeout(55_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err?.name === "TimeoutError" ? "timeout" : String(err);
    return NextResponse.json(
      { error: msg, target: `${PYTHON_BASE}/api/analyze` },
      { status: 500 }
    );
  }
}
