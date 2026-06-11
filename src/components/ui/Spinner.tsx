import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-block h-5 w-5 rounded-full border-2 border-zinc-600 border-t-indigo-400 animate-spin",
        className
      )}
    />
  );
}
