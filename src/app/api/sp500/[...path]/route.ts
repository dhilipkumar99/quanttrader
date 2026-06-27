import { NextRequest, NextResponse } from "next/server";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sp500/[...path]">) {
  const { path } = await ctx.params;
  const url = `${PYTHON_BASE}/api/sp500/${path.join("/")}${req.nextUrl.search}`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(9_500), cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
