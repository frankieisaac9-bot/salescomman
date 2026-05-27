import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "gold" | "muted" | "danger" }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        variant === "default" && "border-blue-400/30 bg-blue-400/10 text-blue-200",
        variant === "gold" && "border-command-gold/40 bg-command-gold/15 text-command-gold",
        variant === "muted" && "border-white/10 bg-white/5 text-muted-foreground",
        variant === "danger" && "border-red-400/30 bg-red-400/10 text-red-200",
        className
      )}
      {...props}
    />
  );
}
