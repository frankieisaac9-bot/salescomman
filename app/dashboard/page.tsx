import { DollarSign, Percent, PhoneCall, Target, TrendingUp } from "lucide-react";
import { DashboardCharts } from "@/components/dashboard-charts";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCloserCalls, getDailyStats } from "@/lib/data";
import { calculateMetricsFromDailyStats } from "@/lib/metrics";
import { isOvercome, mapObstacle, OBJ_LABELS } from "@/lib/objections";
import { currency, percent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const mtdSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthName = now.toLocaleString("default", { month: "long" });
  const mtdLabel = `${monthName} to date`;

  const [{ stats: mtdStats }, { stats: allStats }, { calls: closerCalls }] = await Promise.all([
    getDailyStats(mtdSince),
    getDailyStats(),
    getCloserCalls()
  ]);

  const metrics = calculateMetricsFromDailyStats(mtdStats);

  // Objection breakdown from post-call form obstacles — same mapping as the Objections page
  const objectionCounts = new Map<string, number>();
  for (const call of closerCalls) {
    const type = mapObstacle(call.obstacles ?? "");
    if (!type || type === "na") continue;
    const label = OBJ_LABELS[type];
    objectionCounts.set(label, (objectionCounts.get(label) ?? 0) + 1);
  }
  const objectionData = Array.from(objectionCounts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Live feed — most recent post-call form submissions
  const recent = [...closerCalls].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return (
    <>
      <RealtimeRefresh />
      <PageHeader
        title="SalesCommand"
        description="Command center synced from the tracking sheets — booked calls, closes, cash collection, objections, and rep performance."
      />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Calls Booked" value={String(metrics.callsBooked)} icon={PhoneCall} detail={mtdLabel} />
        <KpiCard label="Show Rate" value={percent(metrics.showRate)} icon={Percent} tone="green" detail={`${metrics.showed} showed`} />
        <KpiCard label="Close Rate" value={percent(metrics.closeRate)} icon={Target} tone="gold" detail={`${metrics.callsClosed} closed`} />
        <KpiCard label="Cash Collected" value={currency(metrics.cashCollected)} icon={DollarSign} tone="gold" detail={mtdLabel} />
        <KpiCard label="Revenue" value={currency(metrics.revenueGenerated)} icon={TrendingUp} tone="blue" detail={mtdLabel} />
      </div>
      <DashboardCharts dailyStats={allStats} objectionData={objectionData} />
      {recent.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Live Call Feed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.map((call) => (
              <div key={call.id} className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{call.rep_name}</div>
                  <div className="text-sm text-muted-foreground">
                    {call.lead_email ?? "No email"} · {new Date(call.date + "T00:00:00").toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={isOvercome(call.lead_status) ? "gold" : "default"}>{call.lead_status ?? "—"}</Badge>
                  <span className="text-sm font-semibold">{currency(Number(call.cash_collected))}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
