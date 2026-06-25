"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import {
  loadAlerts, saveAlerts, evaluateAlert, triggerAlert,
  sendBrowserNotification, type AlertRule,
} from "@/lib/alerts";
import { AlertsPanel } from "@/components/panels/AlertsPanel";
import { api } from "@/lib/api";

const POLL_MS = 60_000;

export function AlertBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [newTrigger, setNewTrigger] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAndSet = useCallback(() => {
    setAlerts(loadAlerts());
  }, []);

  // Evaluate all active alerts against current prices
  const evaluateAll = useCallback(async () => {
    const current = loadAlerts();
    const active = current.filter(a => a.status === "active");
    if (!active.length) return;

    // Batch: unique symbols among active alerts
    const symbols = [...new Set(active.map(a => a.symbol))];
    const prices: Record<string, { price: number; change_pct: number }> = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        prices[sym] = await api.quote(sym);
      } catch {
        // skip
      }
    }));

    let changed = false;
    const next = current.map(rule => {
      if (rule.status !== "active") return rule;
      const q = prices[rule.symbol];
      if (!q || !q.price) return rule;
      if (evaluateAlert(rule, q.price, q.change_pct)) {
        sendBrowserNotification(rule, q.price);
        changed = true;
        return triggerAlert(rule, q.price);
      }
      return rule;
    });

    if (changed) {
      saveAlerts(next);
      setAlerts(next);
      setNewTrigger(true);
    }
  }, []);

  // Load alerts on mount and start polling
  useEffect(() => {
    loadAndSet();
    evaluateAll();
    pollRef.current = setInterval(evaluateAll, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [evaluateAll, loadAndSet]);

  // Sync from localStorage when panel closes (user may have added/deleted alerts in panel)
  const handleClose = () => {
    setOpen(false);
    loadAndSet();
    setNewTrigger(false);
  };

  const triggered = alerts.filter(a => a.status === "triggered").length;
  const active    = alerts.filter(a => a.status === "active").length;
  const badge     = triggered > 0 ? triggered : active > 0 ? active : 0;
  const badgeColor = triggered > 0 ? "var(--green)" : "var(--yellow)";

  return (
    <>
      <button
        onClick={() => { setOpen(o => !o); setNewTrigger(false); }}
        title="Price Alerts"
        style={{
          position: "relative",
          color: open ? "#FFFFFF" : triggered > 0 ? "var(--green)" : active > 0 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)",
          background: open ? "rgba(196,30,58,0.15)" : "transparent",
          border: "none",
          cursor: "pointer",
          padding: "6px 10px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          transition: "color 0.2s, background 0.2s",
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.color = "#FFFFFF";
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.color = triggered > 0 ? "var(--green)" : active > 0 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)";
        }}
      >
        <Bell className="h-3.5 w-3.5" style={{ animation: newTrigger ? "ring 0.4s ease" : "none" }} />
        {badge > 0 && (
          <span style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 14,
            height: 14,
            background: badgeColor,
            color: "#FFFFFF",
            fontFamily: "'SF Mono', monospace",
            fontSize: 8,
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && <AlertsPanel onClose={handleClose} />}
    </>
  );
}
