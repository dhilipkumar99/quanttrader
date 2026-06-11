"use client";

import { useLivePrice } from "@/hooks/useLivePrice";
import { cn, fmtPct } from "@/lib/utils";
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
    <div className="flex flex-wrap items-baseline gap-3 mb-1">
      <h1 className="text-2xl font-black text-zinc-100">{symbol}</h1>
      <span
        className={cn(
          "text-2xl font-bold transition-colors duration-300",
          flash === "up"   ? "text-emerald-300" :
          flash === "down" ? "text-rose-300"    : "text-zinc-200"
        )}
      >
        ${price.toFixed(2)}
      </span>
      <span className={cn("text-sm font-semibold", changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
        {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
      </span>
      {live.price > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-zinc-600 ml-1">
          <Activity className="h-2.5 w-2.5 text-emerald-600 animate-pulse" />
          Live
        </span>
      )}
    </div>
  );
}
