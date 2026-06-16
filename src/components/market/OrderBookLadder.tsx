"use client";
import { useEffect, useState, useCallback } from "react";
import { marketApi } from "@/lib/marketApi";
import type { OrderBook, BookLevel } from "@/types/quant";

function DepthRow({ level, maxSize, side }: { level: BookLevel; maxSize: number; side: "bid" | "ask" }) {
  const pct = maxSize > 0 ? (level.size / maxSize) * 100 : 0;
  const barColor = side === "bid" ? "rgba(0,212,170,0.15)" : "rgba(255,71,87,0.15)";
  const numColor = side === "bid" ? "var(--green)" : "var(--red)";
  return (
    <div className="relative flex items-center h-5 overflow-hidden text-[11px]" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="absolute inset-y-0 pointer-events-none"
        style={{ width: `${pct}%`, background: barColor, [side === "bid" ? "right" : "left"]: 0, position: "absolute" }} />
      <span className="relative z-10 flex-1 num font-medium px-2" style={{ color: numColor }}>
        {level.price.toFixed(2)}
      </span>
      <span className="relative z-10 num px-2" style={{ color: "var(--text-secondary)" }}>
        {level.size.toLocaleString()}
      </span>
    </div>
  );
}

export function OrderBookLadder({ symbol, refreshMs = 3000 }: { symbol: string; refreshMs?: number }) {
  const [book, setBook]       = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await marketApi.orderbook(symbol); setBook(d); }
    catch { /* silent */ } finally { setLoading(false); }
  }, [symbol]);

  useEffect(() => { setLoading(true); load(); const id = setInterval(load, refreshMs); return () => clearInterval(id); }, [load, refreshMs]);

  const topBids = book?.bids?.slice(0, 10) ?? [];
  const topAsks = book?.asks?.slice(0, 10) ?? [];
  const maxBid  = Math.max(...topBids.map(b => b.size), 1);
  const maxAsk  = Math.max(...topAsks.map(a => a.size), 1);

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Order Book — {symbol}</span>
        {book?.synthetic && <span className="badge badge-yellow">Simulated</span>}
        {book && <span className="num text-[10px]" style={{ color: "var(--text-muted)" }}>
          spread ${book.spread.toFixed(4)} · mid ${book.mid_price.toFixed(2)}
        </span>}
      </div>
      {loading ? (
        <div className="p-2 space-y-0.5">
          {[...Array(10)].map((_, i) => <div key={i} className="h-5 animate-pulse" style={{ background: "var(--bg-raised)" }} />)}
        </div>
      ) : (
        <div>
          <div className="flex justify-between px-2 py-1 text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)", background: "var(--bg-raised)" }}>
            <span style={{ color: "var(--red)" }}>Ask</span><span>Size</span>
          </div>
          {[...topAsks].reverse().map((a, i) => <DepthRow key={i} level={a} maxSize={maxAsk} side="ask" />)}
          {book && (
            <div className="flex items-center gap-2 px-2 py-1.5" style={{ background: "var(--bg-active)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
              <span className="num font-bold text-sm" style={{ color: "var(--text-primary)" }}>${book.mid_price.toFixed(2)}</span>
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>mid</span>
            </div>
          )}
          <div className="flex justify-between px-2 py-1 text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)", background: "var(--bg-raised)" }}>
            <span style={{ color: "var(--green)" }}>Bid</span><span>Size</span>
          </div>
          {topBids.map((b, i) => <DepthRow key={i} level={b} maxSize={maxBid} side="bid" />)}
        </div>
      )}
    </div>
  );
}
