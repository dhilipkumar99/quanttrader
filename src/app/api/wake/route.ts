import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

// Pings Render /health to wake it from free-tier sleep.
// Called on page load — completes in <1s if warm, ~30s if cold.
// The frontend polls this until it gets {"status":"ok"} before
// making real API calls, preventing 504s on cold starts.
export async function GET() {
  try {
    const res = await fetch(`${PYTHON_BASE}/health`, {
      signal: AbortSignal.timeout(55_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ status: "sleeping" }, { status: 503 });
  }
}
