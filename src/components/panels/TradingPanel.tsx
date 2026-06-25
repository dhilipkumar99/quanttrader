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
import { AlertTriangle, Link2 } from "lucide-react";
import { useTrader } from "@/store/trader";
import { useRouter } from "next/navigation";

const SERIF = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";

interface Props {
  defaultSymbol?: string;
  onSelectSymbol?: (sym: string) => void;
}

export function TradingPanel({ defaultSymbol = "AAPL", onSelectSymbol }: Props) {
  const { onboarding } = useTrader();
  const router = useRouter();
  const [symbol, setSymbol] = useState(defaultSymbol.toUpperCase());
  const [input,  setInput]  = useState(defaultSymbol.toUpperCase());
  const [refreshKey, setRefreshKey] = useState(0);

  if (!onboarding.brokerConnected) {
    return (
      <div style={{ maxWidth: "520px", margin: "60px auto", padding: "40px 32px", border: "2px solid var(--border)", background: "var(--bg-card)" }}>
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
          <Link2 size={28} style={{ color: "var(--blue)", flexShrink: 0, marginTop: "2px" }} />
          <div>
            <div style={{ fontFamily: "'Times New Roman', Times, Georgia, serif", fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
              Connect a broker to trade
            </div>
            <p style={{ fontFamily: SERIF, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "20px" }}>
              Trading requires an Alpaca account. Alpaca is free to set up and offers paper trading
              with fake money — so you can test everything risk-free before going live.
            </p>
            <div style={{ padding: "14px 16px", background: "rgba(11,31,58,0.04)", border: "1px solid var(--border)", marginBottom: "20px" }}>
              <div style={{ fontFamily: SERIF, fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                Setup takes 2 minutes:
              </div>
              <ol style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 2, margin: 0, paddingLeft: "18px" }}>
                <li>Create a free account at <span style={{ fontFamily: "'SF Mono', monospace", color: "var(--blue)" }}>alpaca.markets</span></li>
                <li>Go to Paper Trading → API Keys → Generate Key</li>
                <li>Paste your key &amp; secret into your profile</li>
              </ol>
            </div>
            <button
              onClick={() => router.push("/onboarding")}
              style={{
                padding: "10px 24px", background: "var(--blue)", color: "#fff",
                border: "none", cursor: "pointer",
                fontFamily: SERIF, fontSize: "13px", fontWeight: 600,
              }}
            >
              Set up broker connection →
            </button>
          </div>
        </div>
      </div>
    );
  }

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

