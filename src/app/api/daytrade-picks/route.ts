import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const p              = req.nextUrl.searchParams;
  const limit          = p.get("limit")          ?? "20";
  const horizon        = p.get("horizon")        ?? "day";
  const universe       = p.get("universe")       ?? "sp500";
  const includeShorts  = p.get("include_shorts") ?? "false";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/daytrade-picks?limit=${limit}&horizon=${encodeURIComponent(horizon)}&universe=${encodeURIComponent(universe)}&include_shorts=${includeShorts}`,
      { signal: AbortSignal.timeout(120_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
