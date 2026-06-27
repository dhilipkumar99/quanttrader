import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.PYTHON_API_BASE ?? "(not set — will use localhost:8787)";
  return NextResponse.json({ PYTHON_API_BASE: base }, { headers: { "Cache-Control": "no-store" } });
}
