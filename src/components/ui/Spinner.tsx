import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("inline-block h-5 w-5 rounded-full animate-spin", className)}
      style={{ border: "2px solid var(--border-strong)", borderTopColor: "var(--blue)" }}
    />
  );
}
