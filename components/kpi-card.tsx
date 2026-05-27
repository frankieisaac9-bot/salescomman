import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "blue"
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "blue" | "gold" | "green" | "red";
}) {
  return (
    <Card className="glass-panel overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-3xl font-black tracking-normal">{value}</div>
          </div>
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg",
              tone === "blue" && "bg-blue-500/15 text-blue-300",
              tone === "gold" && "bg-command-gold/15 text-command-gold",
              tone === "green" && "bg-emerald-500/15 text-emerald-300",
              tone === "red" && "bg-red-500/15 text-red-300"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {detail ? <div className="mt-3 text-xs text-muted-foreground">{detail}</div> : null}
      </CardContent>
    </Card>
  );
}
