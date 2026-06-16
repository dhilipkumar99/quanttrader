// Price alert rules — persisted to localStorage, evaluated on every live-price tick.

export type AlertCondition =
  | "price_above"
  | "price_below"
  | "change_pct_above"   // e.g. up >3% today
  | "change_pct_below";  // e.g. down >-3% today

export type AlertStatus = "active" | "triggered" | "dismissed";

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  label: string;         // human-readable, e.g. "AAPL above $200"
  createdAt: string;
  status: AlertStatus;
  triggeredAt?: string;
  triggeredPrice?: number;
}

const STORAGE_KEY = "qt_price_alerts";

export function loadAlerts(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveAlerts(rules: AlertRule[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function createAlert(
  symbol: string,
  condition: AlertCondition,
  threshold: number
): AlertRule {
  const condLabel =
    condition === "price_above"      ? `above $${threshold.toFixed(2)}` :
    condition === "price_below"      ? `below $${threshold.toFixed(2)}` :
    condition === "change_pct_above" ? `up >${threshold.toFixed(1)}% today` :
                                       `down <${threshold.toFixed(1)}% today`;
  return {
    id:        `${symbol}-${condition}-${Date.now()}`,
    symbol:    symbol.toUpperCase(),
    condition,
    threshold,
    label:     `${symbol.toUpperCase()} ${condLabel}`,
    createdAt: new Date().toISOString(),
    status:    "active",
  };
}

export function evaluateAlert(
  rule: AlertRule,
  price: number,
  changePct: number
): boolean {
  if (rule.status !== "active") return false;
  switch (rule.condition) {
    case "price_above":      return price >= rule.threshold;
    case "price_below":      return price <= rule.threshold;
    case "change_pct_above": return changePct >= rule.threshold;
    case "change_pct_below": return changePct <= rule.threshold;
  }
}

export function triggerAlert(rule: AlertRule, price: number): AlertRule {
  return { ...rule, status: "triggered", triggeredAt: new Date().toISOString(), triggeredPrice: price };
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return Promise.resolve("denied");
  }
  if (Notification.permission === "granted") return Promise.resolve("granted");
  return Notification.requestPermission();
}

export function sendBrowserNotification(rule: AlertRule, price: number): void {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  new Notification(`QuantTrader Alert: ${rule.symbol}`, {
    body: `${rule.label} — current price $${price.toFixed(2)}`,
    icon: "/favicon.ico",
    tag:  rule.id,
  });
}
