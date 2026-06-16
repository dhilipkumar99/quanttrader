"use client";
import { useState } from "react";
import { marketApi } from "@/lib/marketApi";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Side  = "buy" | "sell";
type OType = "market" | "limit";

export function OrderEntryForm({ symbol, currentPrice, onOrderFilled }: {
  symbol: string; currentPrice?: number; onOrderFilled?: () => void;
}) {
  const [side,       setSide]       = useState<Side>("buy");
  const [orderType,  setOrderType]  = useState<OType>("market");
  const [qty,        setQty]        = useState("1");
  const [limitPrice, setLimitPrice] = useState(currentPrice?.toFixed(2) ?? "");
  const [tif,        setTif]        = useState<"day" | "gtc">("day");
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<{ ok: boolean; msg: string } | null>(null);

  const notional = (() => {
    const q = parseFloat(qty);
    const p = orderType === "limit" ? parseFloat(limitPrice) : (currentPrice ?? 0);
    return isNaN(q) || isNaN(p) ? null : q * p;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const q = parseFloat(qty);
    if (!q || q <= 0) { setResult({ ok: false, msg: "Enter a valid quantity" }); return; }
    if (orderType === "limit" && !parseFloat(limitPrice)) { setResult({ ok: false, msg: "Enter a valid limit price" }); return; }
    setLoading(true);
    try {
      const res = await marketApi.submitOrder({
        symbol, qty: q, side, order_type: orderType,
        limit_price: orderType === "limit" ? parseFloat(limitPrice) : undefined,
        time_in_force: tif,
      });
      if (res.error) setResult({ ok: false, msg: res.message ?? res.error });
      else { setResult({ ok: true, msg: `${side.toUpperCase()} ${q} ${symbol} @ ${orderType} submitted` }); onOrderFilled?.(); }
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Order failed" });
    } finally { setLoading(false); }
  };

  return (
    <div className="panel">
      <div className="panel-header">Order Entry — {symbol}</div>
      <form onSubmit={handleSubmit} className="p-3 space-y-2">
        {/* Side */}
        <div className="flex" style={{ border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden" }}>
          {(["buy", "sell"] as Side[]).map(s => (
            <button key={s} type="button" onClick={() => setSide(s)}
              className="flex-1 py-1.5 text-xs font-bold uppercase transition-all"
              style={{
                background: side === s ? (s === "buy" ? "var(--green)" : "var(--red)") : "var(--bg-raised)",
                color: side === s ? (s === "buy" ? "#000" : "#fff") : "var(--text-muted)",
              }}>
              {s}
            </button>
          ))}
        </div>

        {/* Order type */}
        <div className="flex gap-1.5">
          {(["market", "limit"] as OType[]).map(t => (
            <button key={t} type="button" onClick={() => setOrderType(t)}
              className="flex-1 py-1 text-[11px] transition-all"
              style={{
                background: orderType === t ? "var(--blue-dim)" : "var(--bg-raised)",
                border: `1px solid ${orderType === t ? "var(--blue)" : "var(--border)"}`,
                color: orderType === t ? "var(--blue)" : "var(--text-muted)",
                borderRadius: 2,
              }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Qty */}
        <div>
          <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Shares</div>
          <input type="number" min="0.001" step="any" value={qty} onChange={e => setQty(e.target.value)}
            className="et-input" placeholder="0" />
        </div>

        {orderType === "limit" && (
          <div>
            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Limit Price</div>
            <input type="number" min="0.01" step="0.01" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
              className="et-input" placeholder={currentPrice?.toFixed(2)} />
          </div>
        )}

        {/* TIF */}
        <div className="flex gap-1.5">
          {(["day", "gtc"] as const).map(t => (
            <button key={t} type="button" onClick={() => setTif(t)}
              className="flex-1 py-1 text-[10px] transition-all"
              style={{
                background: tif === t ? "var(--bg-active)" : "var(--bg-raised)",
                border: `1px solid ${tif === t ? "var(--border-strong)" : "var(--border)"}`,
                color: tif === t ? "var(--text-primary)" : "var(--text-muted)",
                borderRadius: 2,
              }}>
              {t === "day" ? "Day" : "GTC"}
            </button>
          ))}
        </div>

        {notional !== null && (
          <div className="text-[10px] text-right" style={{ color: "var(--text-muted)" }}>
            Est. notional: <span className="num" style={{ color: "var(--text-primary)" }}>
              ${notional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {result && (
          <div className="flex items-start gap-1.5 p-2 text-xs"
            style={{
              background: result.ok ? "var(--green-dim)" : "var(--red-dim)",
              border: `1px solid ${result.ok ? "var(--green)" : "var(--red)"}`,
              borderRadius: 2,
              color: result.ok ? "var(--green)" : "var(--red)",
            }}>
            {result.ok ? <CheckCircle2 className="h-3 w-3 flex-shrink-0 mt-0.5" /> : <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />}
            {result.msg}
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-2 text-xs font-bold uppercase transition-all disabled:opacity-50"
          style={{
            background: side === "buy" ? "var(--green)" : "var(--red)",
            color: side === "buy" ? "#000" : "#fff",
            borderRadius: 2,
          }}>
          {loading ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Submitting…</span>
                   : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
        </button>
      </form>
    </div>
  );
}
