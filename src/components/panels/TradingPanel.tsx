"use client";
import { useState, useCallback } from "react";
import { AccountCard } from "@/components/trading/AccountCard";
import { PositionsTable } from "@/components/trading/PositionsTable";
import { OrdersTable } from "@/components/trading/OrdersTable";
import { OrderEntryForm } from "@/components/trading/OrderEntryForm";
import { OrderBookLadder } from "@/components/market/OrderBookLadder";
import { PriceTicker } from "@/components/ui/PriceTicker";
import { AgentPanel } from "@/components/panels/AgentPanel";
import { useLivePrice } from "@/hooks/useLivePrice";
import { AlertTriangle } from "lucide-react";

interface Props {
  defaultSymbol?: string;
  onSelectSymbol?: (sym: string) => void;
}

export function TradingPanel({ defaultSymbol = "AAPL", onSelectSymbol }: Props) {
  const [symbol, setSymbol] = useState(defaultSymbol.toUpperCase());
  const [input,  setInput]  = useState(defaultSymbol.toUpperCase());
  const [refreshKey, setRefreshKey] = useState(0);

  const { price } = useLivePrice(symbol, 10_000);

  const applySymbol = () => {
    const s = input.toUpperCase().trim();
    if (!s) return;
    setSymbol(s);
    onSelectSymbol?.(s);
  };

  const onOrderFilled = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-4">
      {/* Account status */}
      <AccountCard />

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 text-xs"
        style={{ background: "var(--yellow-dim)", border: "1px solid var(--yellow)44", borderRadius: 2, color: "var(--yellow)" }}>
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          <strong style={{ color: "var(--yellow)" }}>Paper Trading Mode by default.</strong>{" "}
          Set <code className="font-mono px-1" style={{ background: "var(--bg-raised)", color: "var(--green)" }}>ALPACA_PAPER=false</code> in .env.local to enable live trading.
          Trading involves risk of loss. This is not financial advice.
        </span>
      </div>

      {/* Symbol selector */}
      <div className="flex items-center gap-2">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Trading symbol:</div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && applySymbol()}
          className="et-input w-28 font-mono uppercase"
        />
        <button onClick={applySymbol} className="et-btn et-btn-secondary text-xs">Load</button>
      </div>

      {/* Price ticker */}
      <PriceTicker
        symbol={symbol}
        initialPrice={0}
        initialChangePct={0}
      />

      {/* Two-column: order book + entry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OrderBookLadder symbol={symbol} refreshMs={8000} />
        <OrderEntryForm symbol={symbol} currentPrice={price ?? undefined} onOrderFilled={onOrderFilled} />
      </div>

      {/* Agent loop — full config, journal, morning digest */}
      <AgentPanel />

      {/* Positions + orders */}
      <div key={refreshKey} className="space-y-4">
        <PositionsTable onSelectSymbol={(s) => { setSymbol(s); setInput(s); onSelectSymbol?.(s); }} />
        <OrdersTable />
      </div>
    </div>
  );
}

