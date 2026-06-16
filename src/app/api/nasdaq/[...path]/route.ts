import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/nasdaq/[...path]">) {
  const { path } = await ctx.params;
  const url = `${PYTHON_BASE}/api/nasdaq/${path.join("/")}${req.nextUrl.search}`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
