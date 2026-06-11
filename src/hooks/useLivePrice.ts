"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

interface LivePrice {
  price: number;
  change_pct: number;
  prevPrice: number;
  direction: "up" | "down" | "flat";
}

export function useLivePrice(symbol: string, intervalMs = 15_000): LivePrice {
  const [data, setData] = useState<LivePrice>({
    price: 0, change_pct: 0, prevPrice: 0, direction: "flat",
  });
  const prevRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const q = await api.quote(symbol);
    if (!q.price) return;
    const prev = prevRef.current;
    setData({
      price: q.price,
      change_pct: q.change_pct,
      prevPrice: prev,
      direction: prev === 0 ? "flat" : q.price > prev ? "up" : q.price < prev ? "down" : "flat",
    });
    prevRef.current = q.price;
  }, [symbol]);

  useEffect(() => {
    prevRef.current = 0;
    poll();
    timerRef.current = setInterval(poll, intervalMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol, intervalMs, poll]);

  return data;
}
