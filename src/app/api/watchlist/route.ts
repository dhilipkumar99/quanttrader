import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const raw     = req.nextUrl.searchParams.get("symbols");
  const symbols = raw ?? "";

  try {
    const url = symbols
      ? `${PYTHON_BASE}/api/watchlist?symbols=${encodeURIComponent(symbols)}`
      : `${PYTHON_BASE}/api/watchlist`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(58_000) });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = (e as Error)?.name === "TimeoutError" ? "timeout" : String(e);
    return NextResponse.json({ watchlist: [], error: msg }, { status: 500 });
  }
}
