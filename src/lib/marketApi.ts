import type {
  OrderBook, MarketMover, SectorData, IndexData,
  OHLCBar, BrokerAccount, BrokerPosition, BrokerOrder, SP500Quote, HeatTile,
} from "@/types/quant";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function get<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(id);
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(id);
  }
}

async function del<T>(path: string, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { method: "DELETE", signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(id);
  }
}

export const marketApi = {
  // ── Market Overview ───────────────────────────────────────────────────────
  indices: () => get<{ indices: IndexData[] }>("/api/market/indices", 20_000),
  sectors: () => get<{ sectors: SectorData[] }>("/api/market/sectors", 20_000),
  movers:  (limit = 10) => get<{ gainers: MarketMover[]; losers: MarketMover[] }>(`/api/market/movers?limit=${limit}`, 25_000),

  // ── Combined scanner (S&P 500 + NASDAQ, served from background cache) ───────
  scannerQuotes: (universe: "sp500" | "nasdaq" | "both" = "both", sort = "volume", limit = 1000) =>
    get<{ quotes: (SP500Quote & { universe: string; rs_rank: number; vol_surge: number })[]; total: number }>(
      `/api/scanner?universe=${universe}&sort=${sort}&limit=${limit}`, 15_000
    ),

  // ── S&P 500 ───────────────────────────────────────────────────────────────
  sp500Symbols: () => get<{ symbols: string[]; count: number }>("/api/sp500/symbols", 5_000),
  sp500Quotes:  (sort = "market_cap", limit = 503) =>
    get<{ quotes: SP500Quote[]; total: number }>(`/api/sp500/quotes?sort=${sort}&limit=${limit}`, 30_000),
  sp500Heat:    () => get<{ heat: HeatTile[] }>("/api/sp500/heat", 30_000),
  sp500Screener: (params: { min_change?: number; max_change?: number; sort?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.min_change != null) q.set("min_change", String(params.min_change));
    if (params.max_change != null) q.set("max_change", String(params.max_change));
    if (params.sort) q.set("sort", params.sort);
    if (params.limit) q.set("limit", String(params.limit));
    return get<{ results: SP500Quote[]; total_matched: number }>(`/api/sp500/screener?${q}`, 30_000);
  },

  // ── Order Book + Bars ─────────────────────────────────────────────────────
  orderbook: (symbol: string) => get<OrderBook>(`/api/broker/orderbook?symbol=${encodeURIComponent(symbol)}`, 10_000),
  bars: (symbol: string, timeframe = "1Day", limit = 100) =>
    get<{ bars: OHLCBar[] }>(`/api/broker/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`, 15_000),

  // ── Broker ────────────────────────────────────────────────────────────────
  account: () => get<BrokerAccount>("/api/broker/account", 10_000),
  positions: () => get<{ positions: BrokerPosition[] }>("/api/broker/positions", 10_000),
  orders: (status = "open") => get<{ orders: BrokerOrder[] }>(`/api/broker/orders?status=${status}`, 10_000),
  submitOrder: (payload: {
    symbol: string; qty: number; side: "buy" | "sell";
    order_type?: "market" | "limit"; limit_price?: number; time_in_force?: "day" | "gtc";
  }) => post<BrokerOrder & { error?: string; message?: string }>("/api/broker/orders", payload),
  cancelOrder: (id: string) => del<{ cancelled?: string; error?: string }>(`/api/broker/orders/${id}`),
};
