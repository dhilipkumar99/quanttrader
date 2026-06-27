import { NextRequest, NextResponse } from "next/server";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols") ?? "";
  const period = req.nextUrl.searchParams.get("period") ?? "6mo";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/charts/batch?symbols=${encodeURIComponent(symbols)}&period=${period}`,
      { signal: AbortSignal.timeout(9_500), cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
