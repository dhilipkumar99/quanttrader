import { NextRequest, NextResponse } from "next/server";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const period = req.nextUrl.searchParams.get("period") ?? "6mo";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/chart-data/${symbol}?period=${period}`,
      { signal: AbortSignal.timeout(9_500) }
    );
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
