import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";
  const root   = path.join(process.cwd());

  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", ["-c", `
import sys, json
sys.path.insert(0, '${root}')
from api.quant.data import fetch_quote
q = fetch_quote('${symbol.toUpperCase()}')
print(json.dumps(q))
`], { env: { ...process.env } });

    let out = "";
    py.stdout.on("data", (d) => { out += d; });
    py.on("close", () => {
      try {
        resolve(NextResponse.json(JSON.parse(out.trim()), {
          headers: { "Cache-Control": "no-store" },
        }));
      } catch {
        resolve(NextResponse.json({ price: 0, change_pct: 0 }));
      }
    });

    // Kill after 8s
    setTimeout(() => { py.kill(); resolve(NextResponse.json({ price: 0, change_pct: 0 })); }, 8000);
  });
}
