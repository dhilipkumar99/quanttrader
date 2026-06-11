"use client";

import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children?: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const positionClass = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left:   "right-full top-1/2 -translate-y-1/2 mr-2",
    right:  "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <div
      ref={ref}
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children ?? (
        <HelpCircle className="h-3.5 w-3.5 text-zinc-600 hover:text-zinc-400 cursor-help transition-colors" />
      )}
      {visible && (
        <div
          role="tooltip"
          className={cn(
            "absolute z-50 w-56 rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2",
            "text-xs text-zinc-300 leading-relaxed shadow-xl",
            "pointer-events-none",
            positionClass
          )}
        >
          {content}
          <div
            className={cn(
              "absolute w-2 h-2 bg-zinc-900 border-zinc-700/60 rotate-45",
              side === "top"    && "top-full -translate-y-1 left-1/2 -translate-x-1/2 border-b border-r",
              side === "bottom" && "bottom-full translate-y-1  left-1/2 -translate-x-1/2 border-t border-l",
              side === "left"   && "left-full -translate-x-1  top-1/2  -translate-y-1/2  border-t border-r",
              side === "right"  && "right-full translate-x-1  top-1/2  -translate-y-1/2  border-b border-l",
            )}
          />
        </div>
      )}
    </div>
  );
}

export function InfoTooltip({ content, className }: { content: string; className?: string }) {
  return <Tooltip content={content} className={className} />;
}
