import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "danger" | "warning" | "muted";
  className?: string;
}

const variantStyles: Record<NonNullable<BadgeProps["variant"]>, React.CSSProperties> = {
  default: { background: "var(--blue-dim)",   color: "var(--blue)",   border: "1px solid var(--blue)44" },
  success: { background: "var(--green-dim)",  color: "var(--green)",  border: "1px solid var(--green)44" },
  danger:  { background: "var(--red-dim)",    color: "var(--red)",    border: "1px solid var(--red)44" },
  warning: { background: "var(--yellow-dim)", color: "var(--yellow)", border: "1px solid var(--yellow)44" },
  muted:   { background: "var(--bg-active)",  color: "var(--text-muted)", border: "1px solid var(--border)" },
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center px-1.5 py-0.5 text-xs font-semibold", className)}
      style={{ borderRadius: 2, ...variantStyles[variant] }}
    >
      {children}
    </span>
  );
}
