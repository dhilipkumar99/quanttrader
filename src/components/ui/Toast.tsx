"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const styles = {
    success: { bg: "bg-emerald-900/90 border-emerald-600/50", Icon: CheckCircle, color: "text-emerald-300" },
    error:   { bg: "bg-rose-900/90 border-rose-600/50",       Icon: XCircle,     color: "text-rose-300" },
    info:    { bg: "bg-zinc-800/90 border-zinc-600/50",        Icon: AlertCircle, color: "text-zinc-300" },
  }[t.type];

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-2xl",
        "text-sm font-medium max-w-sm",
        "animate-in slide-in-from-bottom-2 fade-in-0 duration-200",
        styles.bg
      )}
    >
      <styles.Icon className={cn("h-4 w-4 flex-shrink-0", styles.color)} />
      <span className="text-zinc-200 flex-1">{t.message}</span>
      <button onClick={onDismiss} className="text-zinc-500 hover:text-zinc-300 transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
