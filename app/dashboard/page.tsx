import { DollarSign, Percent, PhoneCall, Target, TrendingUp } from "lucide-react";
import { DashboardCharts } from "@/components/dashboard-charts";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDailyStats, getDashboardData } from "@/lib/data";
import { calculateMetricsFromDailyStats } from "@/lib/metrics";
import { currency, percent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const mtdSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthName = now.toLocaleString("default", { month: "long" });
  const mtdLabel = `${monthName} to date`;

  const [{ stats: mtdStats }, { stats: allStats, reps }, { calls, objections }] = await Promise.all([
    getDailyStats(mtdSince),
    getDailyStats(),
    getDashboardData(90)
  ]);

  const metrics = calculateMetricsFromDailyStats(mtdStats);
  const recent = [...calls].sort((a, b) => b.call_date.localeCompare(a.call_date)).slice(0, 8);

  return (
    <>
      <RealtimeRefresh />
      <PageHeader
        title="SalesCommand"
        description="Live Close.com synced command center for booked calls, closes, cash collection, objections, and rep performance."
      />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Calls Booked" value={String(metrics.callsBooked)} icon={PhoneCall} detail={mtdLabel} />
        <KpiCard label="Show Rate" value={percent(metrics.showRate)} icon={Percent} tone="green" detail={`${metrics.showed} showed`} />
        <KpiCard label="Close Rate" value={percent(metrics.closeRate)} icon={Target} tone="gold" detail={`${metrics.callsClosed} closed`} />
        <KpiCard label="Cash Collected" value={currency(metrics.cashCollected)} icon={DollarSign} tone="gold" detail={mtdLabel} />
        <KpiCard label="Revenue" value={currency(metrics.revenueGenerated)} icon={TrendingUp} tone="blue" detail={mtdLabel} />
      </div>
      <DashboardCharts dailyStats={allStats} reps={reps} objections={objections} />
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Live Call Feed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.map((call) => (
            <div key={call.id} className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{call.reps?.name ?? "Unassigned rep"}</div>
                <div className="text-sm text-muted-foreground">{call.product_offered ?? "No product"} · {new Date(call.call_date).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={call.status === "closed" ? "gold" : "default"}>{call.status.replace("_", " ")}</Badge>
                <span className="text-sm font-semibold">{currency(call.revenue_generated)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
