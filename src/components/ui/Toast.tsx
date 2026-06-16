"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

let _listeners: ((t: ToastMessage) => void)[] = [];
let _id = 0;

export function toast(message: string, type: ToastType = "info") {
  const t = { id: ++_id, type, message };
  _listeners.forEach(fn => fn(t));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const fn = (t: ToastMessage) => {
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000);
    };
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-4 z-50 flex flex-col gap-1.5 pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const cfg = {
    success: { bg: "var(--green-dim)",  border: "var(--green)", Icon: CheckCircle, color: "var(--green)" },
    error:   { bg: "var(--red-dim)",    border: "var(--red)",   Icon: XCircle,     color: "var(--red)" },
    info:    { bg: "var(--bg-raised)",  border: "var(--border-strong)", Icon: AlertCircle, color: "var(--text-secondary)" },
  }[t.type];

  return (
    <div
      className="pointer-events-auto flex items-center gap-2 px-3 py-2 text-xs font-medium max-w-xs animate-in slide-in-from-bottom-2 fade-in-0 duration-200"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: "3px",
        color: "var(--text-primary)",
      }}
    >
      <cfg.Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: cfg.color }} />
      <span className="flex-1">{t.message}</span>
      <button onClick={onDismiss} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
