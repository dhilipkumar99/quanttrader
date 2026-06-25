import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const p             = req.nextUrl.searchParams;
  const limit         = p.get("limit")          ?? "20";
  const horizon       = p.get("horizon")        ?? "day";
  const universe      = p.get("universe")       ?? "sp500";
  const includeShorts = p.get("include_shorts") ?? "false";
  const beginner      = p.get("beginner")       ?? "false";

  const url = `${PYTHON_BASE}/api/daytrade-picks?limit=${limit}&horizon=${encodeURIComponent(horizon)}&universe=${encodeURIComponent(universe)}&include_shorts=${includeShorts}&beginner=${beginner}`;

  // daytrade-picks scans 80–150 symbols — retry on 503 "computing" within budget
  const delays = [0, 2000];
  let lastRes: Response | null = null;

  for (const delay of delays) {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4_500) });
      if (res.status !== 503) {
        const data = await res.json();
        return NextResponse.json(data, {
          status: res.status,
          headers: res.ok
            ? { "Cache-Control": "s-maxage=900, stale-while-revalidate=3600" }
            : { "Cache-Control": "no-store" },
        });
      }
      lastRes = res;
    } catch (e: unknown) {
      const err = e as Error;
      if (err?.name === "TimeoutError") continue;
      return NextResponse.json({ error: String(err) }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (lastRes) {
    const data = await lastRes.json().catch(() => ({ error: "computing" }));
    return NextResponse.json(data, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    });
  }
  return NextResponse.json({ error: "timeout" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
