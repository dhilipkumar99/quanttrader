import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const horizon = req.nextUrl.searchParams.get("horizon") ?? "swing";
  try {
    const res = await fetch(`${PYTHON_BASE}/api/leaderboard?horizon=${encodeURIComponent(horizon)}`, {
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
