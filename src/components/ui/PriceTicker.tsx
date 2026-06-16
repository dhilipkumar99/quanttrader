"use client";

import { useLivePrice } from "@/hooks/useLivePrice";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";

interface Props {
  symbol: string;
  initialPrice: number;
  initialChangePct: number;
}

export function PriceTicker({ symbol, initialPrice, initialChangePct }: Props) {
  const live = useLivePrice(symbol);
  const price = live.price || initialPrice;
  const changePct = live.price ? live.change_pct : initialChangePct;
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPrice = useRef(initialPrice);

  useEffect(() => {
    if (!live.price || live.price === prevPrice.current) return;
    setFlash(live.price > prevPrice.current ? "up" : "down");
    prevPrice.current = live.price;
    const id = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(id);
  }, [live.price]);

  return (
    <div
      className={cn(
        "panel flex flex-wrap items-baseline gap-3 px-3 py-2",
        flash === "up"   && "flash-up",
        flash === "down" && "flash-down"
      )}
    >
      <span className="text-sm font-bold font-mono" style={{ color: "var(--text-secondary)" }}>{symbol}</span>
      <span
        className="text-xl font-bold num"
        style={{
          color: flash === "up"   ? "var(--green)" :
                 flash === "down" ? "var(--red)"   : "var(--text-primary)",
          transition: "color 0.3s",
        }}
      >
        ${(price ?? 0).toFixed(2)}
      </span>
      <span
        className="text-sm font-semibold num"
        style={{ color: (changePct ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
      >
        {(changePct ?? 0) >= 0 ? "+" : ""}{(changePct ?? 0).toFixed(2)}%
      </span>
      {live.price > 0 && (
        <span className="flex items-center gap-1 text-[10px] ml-1" style={{ color: "var(--text-muted)" }}>
          <Activity className="h-2.5 w-2.5 animate-pulse" style={{ color: "var(--green)" }} />
          Live
        </span>
      )}
    </div>
  );
}
