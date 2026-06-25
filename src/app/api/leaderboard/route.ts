import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const horizon = req.nextUrl.searchParams.get("horizon") ?? "swing";
  try {
    const res = await fetch(`${PYTHON_BASE}/api/leaderboard?horizon=${encodeURIComponent(horizon)}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: res.ok ? { "Cache-Control": "s-maxage=3600, stale-while-revalidate=7200" } : { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
