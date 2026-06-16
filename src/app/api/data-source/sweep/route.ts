import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "true";
  const period = req.nextUrl.searchParams.get("period") ?? "1y";
  try {
    const res = await fetch(
      `${PYTHON_BASE}/api/data-source/sweep?force=${force}&period=${period}`,
      { method: "POST", signal: AbortSignal.timeout(10_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
