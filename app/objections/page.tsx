import { ObjectionTrendChart } from "@/components/objection-trend-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getObjectionsData } from "@/lib/data";
import { objectionsByDay } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function titleCase(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function currency(n: number) {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function pct(n: number) {
  return n.toFixed(1) + "%";
}

const RANK_COLORS = [
  "border-yellow-400/40 bg-yellow-400/5",
  "border-slate-400/30 bg-slate-400/5",
  "border-orange-400/30 bg-orange-400/5",
];
const RANK_BADGES = ["#1", "#2", "#3"];
const RANK_BADGE_COLORS = [
  "bg-yellow-400/20 text-yellow-300",
  "bg-slate-400/20 text-slate-300",
  "bg-orange-400/20 text-orange-300",
];

const MONTHS = [
  { value: "2026-01", label: "Jan" },
  { value: "2026-02", label: "Feb" },
  { value: "2026-03", label: "Mar" },
  { value: "2026-04", label: "Apr" },
  { value: "2026-05", label: "May" },
  { value: "2026-06", label: "Jun" },
  { value: "2026-07", label: "Jul" },
  { value: "2026-08", label: "Aug" },
  { value: "2026-09", label: "Sep" },
  { value: "2026-10", label: "Oct" },
  { value: "2026-11", label: "Nov" },
  { value: "2026-12", label: "Dec" },
  { value: "all", label: "All" },
];

const CURRENT_MONTH = "2026-05";

export default async function ObjectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const selectedMonth = monthParam ?? CURRENT_MONTH;

  const { objections: allObjections, reps } = await getObjectionsData();

  // Filter by selected month
  const objections = selectedMonth === "all"
    ? allObjections
    : allObjections.filter((o) => o.created_at.startsWith(selectedMonth));

  const totalObjections = objections.length;

  // Group by type and compute stats
  const grouped: Record<string, typeof objections> = {};
  for (const obj of objections) {
    const key = obj.type ?? "other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(obj);
  }

  const breakdown = Object.entries(grouped)
    .map(([type, objs]) => {
      const overcome = objs.filter((o) => o.calls?.status === "closed");
      const revenue = overcome.reduce(
        (s, o) => s + (Number(o.calls?.cash_collected) || Number(o.calls?.revenue_generated) || 0),
        0
      );
      return {
        type: titleCase(type),
        count: objs.length,
        pctOfTotal: totalObjections > 0 ? (objs.length / totalObjections) * 100 : 0,
        timesOvercome: overcome.length,
        overcomeRate: objs.length > 0 ? (overcome.length / objs.length) * 100 : 0,
        revenue,
        avgDeal: overcome.length > 0 ? revenue / overcome.length : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  const top3 = breakdown.slice(0, 3);
  const trend = objectionsByDay(objections);

  return (
    <>
      <PageHeader
        title="Objection Intelligence"
        description="Frequency, overcome rates, and revenue impact for every objection logged on calls."
      />

      {/* Month filter */}
      <div className="mb-5 flex flex-wrap gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 w-fit">
        {MONTHS.map((m) => {
          const active = selectedMonth === m.value;
          const future = m.value !== "all" && m.value > CURRENT_MONTH;
          return (
            <a
              key={m.value}
              href={`?month=${m.value}`}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-blue-500 text-white" : future ? "text-slate-600 cursor-default pointer-events-none" : "text-slate-300 hover:text-white hover:bg-white/10",
              ].join(" ")}
            >
              {m.label}
            </a>
          );
        })}
      </div>

      {/* Top 3 podium */}
      {top3.length > 0 && (
        <div className="mb-5 grid gap-4 md:grid-cols-3">
          {top3.map((obj, i) => (
            <Card key={obj.type} className={`border ${RANK_COLORS[i]}`}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${RANK_BADGE_COLORS[i]}`}>
                    {RANK_BADGES[i]}
                  </span>
                  <span className="text-xs text-red-400 font-medium">— {pct(obj.pctOfTotal)}</span>
                </div>
                <div className="text-lg font-bold">{obj.type}</div>
                <div className="mt-1 text-3xl font-black">{obj.count}</div>
                <div className="text-xs text-muted-foreground">{pct(obj.pctOfTotal)} of objections</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  prev. {obj.timesOvercome > 0 ? obj.timesOvercome : 0} overcome
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Breakdown table */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Objection Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Objection", "Count", "% of Objections", "Times Overcome", "Overcome Rate", "Revenue When Overcome", "Avg Deal When Overcome"].map((h) => (
                  <th key={h} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No objections logged yet
                  </td>
                </tr>
              ) : (
                breakdown.map((row) => (
                  <tr key={row.type} className="border-b border-white/10 hover:bg-white/[0.04]">
                    <td className="px-4 py-3 font-medium">{row.type}</td>
                    <td className="px-4 py-3">{row.count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{pct(row.pctOfTotal)}</td>
                    <td className="px-4 py-3">{row.timesOvercome}</td>
                    <td className="px-4 py-3">
                      <span className={row.overcomeRate >= 30 ? "text-emerald-400" : row.overcomeRate >= 15 ? "text-yellow-400" : "text-red-400"}>
                        {pct(row.overcomeRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-emerald-400">
                      {row.revenue > 0 ? currency(row.revenue) : <span className="text-muted-foreground">$0</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {row.avgDeal > 0 ? currency(row.avgDeal) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Trend chart */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Objection Trend Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No trend data yet — log calls with objections to populate this chart
            </div>
          ) : (
            <ObjectionTrendChart data={trend} />
          )}
        </CardContent>
      </Card>

      {/* Per-rep breakdown */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Per-Rep Top Objection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reps.length === 0 ? (
            <div className="text-sm text-muted-foreground">No rep data yet</div>
          ) : (
            reps.map((rep) => {
              const repObjs = objections.filter((o) => o.rep_id === rep.id);
              if (repObjs.length === 0) return null;
              const counts: Record<string, number> = {};
              for (const o of repObjs) counts[o.type] = (counts[o.type] ?? 0) + 1;
              const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
              return (
                <div key={rep.id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <span className="font-medium">{rep.name}</span>
                  <Badge>{top ? `${titleCase(top[0])} (${top[1]})` : "No objections"}</Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Raw log */}
      <Card>
        <CardHeader>
          <CardTitle>Logged Objections</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Date", "Rep", "Type", "Call Date", "Outcome", "Cash", "Notes"].map((h) => (
                  <th key={h} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {objections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No objections logged yet
                  </td>
                </tr>
              ) : (
                objections.map((obj) => (
                  <tr key={obj.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                    <td className="px-4 py-3">{new Date(obj.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{obj.reps?.name ?? "—"}</td>
                    <td className="px-4 py-3"><Badge>{titleCase(obj.type)}</Badge></td>
                    <td className="px-4 py-3">
                      {obj.calls?.call_date ? new Date(obj.calls.call_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {obj.calls?.status ? (
                        <span className={obj.calls.status === "closed" ? "text-emerald-400" : "text-muted-foreground"}>
                          {obj.calls.status.replace("_", " ")}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {obj.calls?.cash_collected ? currency(Number(obj.calls.cash_collected)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{obj.notes ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
