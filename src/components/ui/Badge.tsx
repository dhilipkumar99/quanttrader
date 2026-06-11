import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "danger" | "warning" | "muted";
  className?: string;
}

const variants = {
  default: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  success: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  danger:  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  muted:   "bg-zinc-700/40 text-zinc-400 border-zinc-600/30",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
