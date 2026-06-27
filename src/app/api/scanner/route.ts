import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const p        = req.nextUrl.searchParams;
  const universe = p.get("universe") ?? "both";
  const limit    = p.get("limit")    ?? "1000";
  const sort     = p.get("sort")     ?? "volume";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/scanner/quotes?universe=${universe}&limit=${limit}&sort=${sort}`,
      { signal: AbortSignal.timeout(9_500), cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
