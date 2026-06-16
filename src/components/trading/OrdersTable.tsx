"use client";
import { useEffect, useState, useCallback } from "react";
import { marketApi } from "@/lib/marketApi";
import type { BrokerOrder } from "@/types/quant";
import { X, RefreshCw } from "lucide-react";

export function OrdersTable() {
  const [orders,    setOrders]    = useState<BrokerOrder[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const d = await marketApi.orders("open"); setOrders(d.orders); }
    catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 10_000); return () => clearInterval(id); }, [load]);

  const handleCancel = async (id: string) => {
    setCanceling(id);
    try { await marketApi.cancelOrder(id); await load(); }
    catch { /* silent */ } finally { setCanceling(null); }
  };

  const statusColor = (s: string) => s === "filled" ? "var(--green)" : s === "partially_filled" ? "var(--yellow)" : s === "new" ? "var(--blue)" : "var(--text-muted)";

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Open Orders</span>
        <button onClick={load} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {loading && orders.length === 0 ? (
        <div className="p-3 space-y-1">{[...Array(2)].map((_, i) => <div key={i} className="h-7 animate-pulse" style={{ background: "var(--bg-raised)" }} />)}</div>
      ) : orders.length === 0 ? (
        <div className="py-6 text-center text-xs" style={{ color: "var(--text-disabled)" }}>No open orders</div>
      ) : (
        <table className="t-table">
          <thead>
            <tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Limit</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td style={{ textAlign: "left", paddingLeft: "12px" }}>
                  <span className="font-bold font-mono" style={{ color: "var(--text-primary)" }}>{o.symbol}</span>
                </td>
                <td><span className="font-semibold" style={{ color: o.side === "buy" ? "var(--green)" : "var(--red)" }}>{o.side.toUpperCase()}</span></td>
                <td className="num">{o.qty}</td>
                <td className="capitalize" style={{ color: "var(--text-secondary)" }}>{o.order_type}</td>
                <td className="num" style={{ color: "var(--text-secondary)" }}>{o.limit_price != null ? `$${o.limit_price.toFixed(2)}` : "—"}</td>
                <td>
                  <span className="text-[10px] font-medium px-1.5 py-0.5" style={{ color: statusColor(o.status), background: `${statusColor(o.status)}22`, borderRadius: 2 }}>
                    {o.status}
                  </span>
                </td>
                <td className="pr-2">
                  <button onClick={() => handleCancel(o.id)} disabled={canceling === o.id}
                    className="transition-colors disabled:opacity-40"
                    style={{ color: "var(--text-muted)" }} title="Cancel">
                    <X className="h-3 w-3 hover:text-red-400" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
