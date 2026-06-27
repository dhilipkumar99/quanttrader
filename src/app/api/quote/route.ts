import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";

  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ price: 0, change_pct: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
}
