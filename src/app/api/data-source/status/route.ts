import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const PYTHON_BASE = process.env.PYTHON_API_BASE ?? "http://localhost:8787";

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_BASE}/api/data-source/status`,
      { signal: AbortSignal.timeout(5_000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
