"use client";
import { useEffect, useState } from "react";
import { marketApi } from "@/lib/marketApi";
import type { BrokerAccount } from "@/types/quant";
import { Wifi, WifiOff, ExternalLink } from "lucide-react";

export function AccountCard() {
  const [account, setAccount] = useState<BrokerAccount | null>(null);

  useEffect(() => {
    const load = async () => {
      try { const d = await marketApi.account(); setAccount(d); }
      catch { setAccount({ connected: false, message: "Could not reach broker API" }); }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!account) return <div className="panel h-20 animate-pulse" />;

  if (!account.connected) {
    return (
      <div className="panel p-3" style={{ borderColor: "var(--yellow)", background: "var(--yellow-dim)" }}>
        <div className="flex items-center gap-2 mb-2">
          <WifiOff className="h-3.5 w-3.5" style={{ color: "var(--yellow)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--yellow)" }}>Broker Not Connected</span>
        </div>
        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>{account.message}</p>
        <div className="text-xs font-mono p-2 mb-2" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2 }}>
          <div className="mb-0.5" style={{ color: "var(--text-muted)" }}>Add to .env.local:</div>
          <div style={{ color: "var(--green)" }}>ALPACA_API_KEY=your_key</div>
          <div style={{ color: "var(--green)" }}>ALPACA_SECRET_KEY=your_secret</div>
          <div style={{ color: "var(--green)" }}>ALPACA_PAPER=true</div>
        </div>
        <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs" style={{ color: "var(--blue)" }}>
          Get free Alpaca API keys <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  const dayPL = (account.equity ?? 0) - (account.last_equity ?? account.equity ?? 0);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Wifi className="h-3 w-3" style={{ color: "var(--green)" }} />
          <span>{account.paper ? "Paper Trading Account" : "Live Account"}</span>
          {account.paper && <span className="badge badge-yellow">PAPER</span>}
        </div>
        <span className="badge badge-green">{account.status}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        {[
          { label: "Portfolio",     value: `$${(account.portfolio_value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: "Cash",          value: `$${(account.cash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: "Buying Power",  value: `$${(account.buying_power ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: "Day P&L",       value: `${dayPL >= 0 ? "+" : ""}$${Math.abs(dayPL).toFixed(2)}`, color: dayPL >= 0 ? "var(--green)" : "var(--red)" },
        ].map(item => (
          <div key={item.label} className="p-2" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 2 }}>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{item.label}</div>
            <div className="text-sm font-bold num mt-0.5" style={{ color: (item as any).color ?? "var(--text-primary)" }}>{item.value}</div>
          </div>
        ))}
      </div>
      {account.pattern_day_trader && <div className="px-3 pb-2 text-[10px]" style={{ color: "var(--yellow)" }}>⚠ Pattern Day Trader</div>}
      {account.trading_blocked     && <div className="px-3 pb-2 text-[10px]" style={{ color: "var(--red)" }}>⛔ Trading blocked</div>}
    </div>
  );
}
