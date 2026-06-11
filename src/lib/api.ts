import type { AnalysisResult, BacktestResult, WatchlistItem } from "@/types/quant";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// AbortController-based fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Exponential backoff retry — only retries network errors and 5xx
async function fetchWithRetry(url: string, timeoutMs = 45_000, maxAttempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (res.ok || res.status < 500) return res; // 4xx = client error, don't retry
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
      if ((e as Error)?.name === "AbortError") {
        throw new Error("timeout");
      }
    }
  }
  throw lastErr;
}

async function get<T>(path: string, timeoutMs = 45_000): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, timeoutMs);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg === "no_data" ? "not found" : msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  analyze: (symbol: string, period = "1y") =>
    get<AnalysisResult>(`/api/analyze?symbol=${encodeURIComponent(symbol)}&period=${period}`, 45_000),

  backtest: (symbol: string, period = "1y", cash = 100_000) =>
    get<BacktestResult>(
      `/api/backtest?symbol=${encodeURIComponent(symbol)}&period=${period}&cash=${cash}`,
      55_000  // backtests are slow; give extra time
    ),

  watchlist: (symbols?: string[]) => {
    const q = symbols ? `?symbols=${symbols.map(encodeURIComponent).join(",")}` : "";
    return get<{ watchlist: WatchlistItem[] }>(`/api/watchlist${q}`, 55_000);
  },

  // Lightweight quote-only endpoint (for real-time ticker)
  quote: async (symbol: string): Promise<{ price: number; change_pct: number }> => {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`, 8_000
      );
      if (!res.ok) return { price: 0, change_pct: 0 };
      return res.json();
    } catch {
      return { price: 0, change_pct: 0 };
    }
  },
};
