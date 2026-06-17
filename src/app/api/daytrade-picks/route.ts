import { NextRequest, NextResponse } from "next/server";

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
      { signal: AbortSignal.timeout(9_500) }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
