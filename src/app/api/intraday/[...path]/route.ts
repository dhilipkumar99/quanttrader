import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

async function proxy(req: NextRequest, path: string): Promise<NextResponse> {
  const url = `${PYTHON_BASE}/api/intraday/${path}${req.nextUrl.search}`;
  try {
    const init: RequestInit = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    };
    if (req.method === "POST" || req.method === "PUT") {
      init.body = await req.text();
    }
    const res  = await fetch(url, init);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

type RouteContext<T extends string> = { params: Promise<{ path: string[] }> & { _route?: T } };

export async function GET(req: NextRequest, ctx: RouteContext<"/api/intraday/[...path]">) {
  const { path } = await ctx.params;
  return proxy(req, path.join("/"));
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/intraday/[...path]">) {
  const { path } = await ctx.params;
  return proxy(req, path.join("/"));
}
