"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, X, CheckCircle, Clock, Trash2 } from "lucide-react";
import {
  loadAlerts, saveAlerts, createAlert,
  requestNotificationPermission,
  type AlertRule, type AlertCondition,
} from "@/lib/alerts";
import { useTrader } from "@/store/trader";

const FONT_BODY = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const FONT_MONO = "'SF Mono', 'Fira Code', monospace";

const CONDITION_OPTIONS: { value: AlertCondition; label: string }[] = [
  { value: "price_above",      label: "Price rises above" },
  { value: "price_below",      label: "Price falls below" },
  { value: "change_pct_above", label: "Daily gain exceeds %" },
  { value: "change_pct_below", label: "Daily loss exceeds %" },
];

function conditionUnit(c: AlertCondition): "$" | "%" {
  return c === "price_above" || c === "price_below" ? "$" : "%";
}

function statusIcon(s: AlertRule["status"]) {
  if (s === "triggered") return <CheckCircle className="h-3 w-3" style={{ color: "var(--green)" }} />;
  if (s === "dismissed") return <X className="h-3 w-3" style={{ color: "var(--text-disabled)" }} />;
  return <Clock className="h-3 w-3" style={{ color: "var(--yellow)" }} />;
}

function statusColor(s: AlertRule["status"]): string {
  return s === "triggered" ? "var(--green)" : s === "dismissed" ? "var(--text-disabled)" : "var(--yellow)";
}

interface Props {
  onClose: () => void;
}

export function AlertsPanel({ onClose }: Props) {
  const activeSymbol = useTrader(s => s.activeSymbol);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");

  // Form state
  const [symbol, setSymbol]       = useState(activeSymbol);
  const [condition, setCondition] = useState<AlertCondition>("price_above");
  const [threshold, setThreshold] = useState("");

  // Load from localStorage on mount
  useEffect(() => {
    setAlerts(loadAlerts());
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPerm(Notification.permission);
    }
  }, []);

  // Keep symbol in sync with active symbol when opening form
  useEffect(() => {
    if (showForm) setSymbol(activeSymbol);
  }, [showForm, activeSymbol]);

  const addAlert = useCallback(() => {
    const val = parseFloat(threshold);
    if (!symbol.trim() || isNaN(val) || val <= 0) return;
    const rule = createAlert(symbol.trim().toUpperCase(), condition, val);
    const next = [rule, ...alerts];
    setAlerts(next);
    saveAlerts(next);
    setShowForm(false);
    setThreshold("");
  }, [symbol, condition, threshold, alerts]);

  const deleteAlert = useCallback((id: string) => {
    const next = alerts.filter(a => a.id !== id);
    setAlerts(next);
    saveAlerts(next);
  }, [alerts]);

  const dismissAlert = useCallback((id: string) => {
    const next = alerts.map(a => a.id === id ? { ...a, status: "dismissed" as const } : a);
    setAlerts(next);
    saveAlerts(next);
  }, [alerts]);

  const clearAll = useCallback(() => {
    setAlerts([]);
    saveAlerts([]);
  }, []);

  const requestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
  };

  const active    = alerts.filter(a => a.status === "active");
  const triggered = alerts.filter(a => a.status === "triggered");
  const dismissed = alerts.filter(a => a.status === "dismissed");

  return (
    <div style={{
      position: "fixed",
      top: 52,
      right: 12,
      width: 340,
      maxHeight: "calc(100vh - 80px)",
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderTop: "3px solid var(--red)",
      zIndex: 200,
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px",
        background: "#F8F6F2",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div className="flex items-center gap-1.5">
          <Bell className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
          <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Price Alerts
          </span>
          {active.length > 0 && (
            <span style={{
              background: "var(--yellow-dim)",
              border: "1px solid var(--yellow)",
              color: "var(--yellow)",
              fontSize: 9,
              fontFamily: FONT_MONO,
              padding: "0 4px",
              fontWeight: 700,
            }}>
              {active.length}
            </span>
          )}
          {triggered.length > 0 && (
            <span style={{
              background: "var(--green-dim)",
              border: "1px solid var(--green)",
              color: "var(--green)",
              fontSize: 9,
              fontFamily: FONT_MONO,
              padding: "0 4px",
              fontWeight: 700,
            }}>
              {triggered.length} triggered
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {alerts.length > 0 && (
            <button onClick={clearAll} title="Clear all" style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 9, fontFamily: FONT_BODY }}>
              Clear all
            </button>
          )}
          <button onClick={onClose} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>

        {/* Browser notification permission banner */}
        {typeof window !== "undefined" && "Notification" in window && notifPerm !== "granted" && (
          <div style={{
            padding: "8px 10px",
            background: "var(--blue-dim)",
            border: "1px solid rgba(11,31,58,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.4 }}>
              Enable browser notifications to get alerted even when the tab is in the background.
            </span>
            <button
              onClick={requestPermission}
              style={{
                fontFamily: FONT_BODY,
                fontSize: 9,
                fontWeight: 600,
                padding: "4px 8px",
                background: "var(--navy)",
                color: "#FFFFFF",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                letterSpacing: "0.06em",
                flexShrink: 0,
              }}
            >
              Allow
            </button>
          </div>
        )}

        {/* Add alert form */}
        {showForm ? (
          <div style={{
            padding: "10px",
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2 }}>
              New Alert
            </div>

            <div className="flex gap-2">
              <div style={{ flex: 1 }}>
                <label style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Symbol</label>
                <input
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  maxLength={6}
                  style={{
                    width: "100%",
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "5px 8px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    outline: "none",
                    textTransform: "uppercase",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--red)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
                />
              </div>
            </div>

            <div>
              <label style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Condition</label>
              <select
                value={condition}
                onChange={e => setCondition(e.target.value as AlertCondition)}
                style={{
                  width: "100%",
                  fontFamily: FONT_BODY,
                  fontSize: 11,
                  padding: "5px 8px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {CONDITION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                Threshold ({conditionUnit(condition)})
              </label>
              <div className="flex items-center" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                <span style={{ padding: "5px 8px", fontFamily: FONT_MONO, fontSize: 12, color: "var(--text-muted)" }}>
                  {conditionUnit(condition)}
                </span>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addAlert()}
                  placeholder="0.00"
                  step={conditionUnit(condition) === "$" ? "0.01" : "0.1"}
                  min="0"
                  style={{
                    flex: 1,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "5px 8px 5px 0",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={addAlert}
                disabled={!symbol.trim() || !threshold}
                style={{
                  flex: 1,
                  fontFamily: FONT_BODY,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "6px",
                  background: "var(--navy)",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  opacity: (!symbol.trim() || !threshold) ? 0.4 : 1,
                }}
              >
                Create Alert
              </button>
              <button
                onClick={() => { setShowForm(false); setThreshold(""); }}
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 10,
                  padding: "6px 12px",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            style={{
              width: "100%",
              fontFamily: FONT_BODY,
              fontSize: 10,
              fontWeight: 600,
              padding: "8px",
              background: "transparent",
              border: "1px dashed var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "var(--red)";
              e.currentTarget.style.color = "var(--red)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <Plus className="h-3 w-3" />
            New Alert
          </button>
        )}

        {/* Alert list */}
        {alerts.length === 0 && !showForm && (
          <div style={{ textAlign: "center", padding: "20px 0", fontFamily: FONT_BODY, fontSize: 11, color: "var(--text-disabled)", lineHeight: 1.6 }}>
            No alerts yet.<br />
            Create one to be notified when a price threshold is crossed.
          </div>
        )}

        {/* Triggered alerts (highlighted) */}
        {triggered.length > 0 && (
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--green)", marginBottom: 5 }}>
              Triggered
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {triggered.map(rule => (
                <AlertRow key={rule.id} rule={rule} onDelete={deleteAlert} onDismiss={dismissAlert} />
              ))}
            </div>
          </div>
        )}

        {/* Active alerts */}
        {active.length > 0 && (
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>
              Watching
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {active.map(rule => (
                <AlertRow key={rule.id} rule={rule} onDelete={deleteAlert} onDismiss={dismissAlert} />
              ))}
            </div>
          </div>
        )}

        {/* Dismissed alerts (collapsed) */}
        {dismissed.length > 0 && (
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-disabled)", marginBottom: 5 }}>
              Dismissed ({dismissed.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {dismissed.map(rule => (
                <AlertRow key={rule.id} rule={rule} onDelete={deleteAlert} onDismiss={dismissAlert} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AlertRow ──────────────────────────────────────────────────────────────────

function AlertRow({ rule, onDelete, onDismiss }: {
  rule: AlertRule;
  onDelete: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const isDismissed = rule.status === "dismissed";
  const isTriggered = rule.status === "triggered";

  return (
    <div
      className="group flex items-start gap-2"
      style={{
        padding: "7px 10px",
        background: isTriggered ? "var(--green-dim)" : isDismissed ? "transparent" : "var(--bg-raised)",
        border: `1px solid ${isTriggered ? "rgba(26,107,74,0.2)" : "var(--border)"}`,
        opacity: isDismissed ? 0.5 : 1,
      }}
    >
      <div className="flex-shrink-0 mt-0.5">{statusIcon(rule.status)}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>
            {rule.symbol}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: statusColor(rule.status) }}>
            {rule.label.replace(rule.symbol + " ", "")}
          </span>
        </div>
        {isTriggered && rule.triggeredAt && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--green)", marginTop: 2 }}>
            Triggered at ${rule.triggeredPrice?.toFixed(2)} · {new Date(rule.triggeredAt).toLocaleTimeString()}
          </div>
        )}
        {!isTriggered && !isDismissed && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 9, color: "var(--text-disabled)", marginTop: 1 }}>
            Set {new Date(rule.createdAt).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isTriggered && (
          <button
            onClick={() => onDismiss(rule.id)}
            title="Dismiss"
            style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 2 }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--yellow)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <CheckCircle className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => onDelete(rule.id)}
          title="Delete"
          style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 2 }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
