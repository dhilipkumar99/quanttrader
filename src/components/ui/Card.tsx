import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}

export function Card({ children, className, glow }: CardProps) {
  return (
    <div
      className={cn("panel p-3", glow && "ring-1", className)}
      style={glow ? { boxShadow: "0 0 0 1px var(--blue), 0 4px 20px rgba(59,130,246,0.08)" } : undefined}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel-header -mx-3 -mt-3 mb-3", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[11px] font-semibold uppercase tracking-widest", className)}
      style={{ color: "var(--text-secondary)" }}>
      {children}
    </span>
  );
}
