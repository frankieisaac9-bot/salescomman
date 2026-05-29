import { ObjectionTrendChart } from "@/components/objection-trend-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCloserCalls } from "@/lib/data";

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

type ObjType = "money_logistics" | "money_fear" | "partner" | "think_about_it" | "fear_of_failure" | "na";

const OBJ_LABELS: Record<ObjType, string> = {
  money_logistics: "Money Logistics",
  money_fear: "Money Fear",
  partner: "Partner",
  think_about_it: "Think About It",
  fear_of_failure: "Fear of Failure",
  na: "N/A",
};

function mapObstacle(raw: string): ObjType | null {
  const v = raw.toLowerCase().trim();
  if (v.includes("money") && v.includes("log")) return "money_logistics";
  if (v.includes("money") && (v.includes("fear") || v.includes("scare"))) return "money_fear";
  if (v.includes("money") || v.includes("logistics") || v.includes("financial") || v.includes("price") || v.includes("cost")) return "money_logistics";
  if (v.includes("partner")) return "partner";
  if (v.includes("fear") && v.includes("fail")) return "fear_of_failure";
  if (v.includes("fear")) return "fear_of_failure";
  if (v.includes("think")) return "think_about_it";
  if (v === "n/a" || v === "na") return "na";
  return null;
}

function isOvercome(leadStatus: string | null): boolean {
  const s = (leadStatus ?? "").toLowerCase();
  return s.includes("closed") || s.includes("deposit") || s.includes("won");
}

const now = new Date();
const CURRENT_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const MONTHS = [
  { value: "2026-01", label: "Jan" }, { value: "2026-02", label: "Feb" },
  { value: "2026-03", label: "Mar" }, { value: "2026-04", label: "Apr" },
  { value: "2026-05", label: "May" }, { value: "2026-06", label: "Jun" },
  { value: "2026-07", label: "Jul" }, { value: "2026-08", label: "Aug" },
  { value: "2026-09", label: "Sep" }, { value: "2026-10", label: "Oct" },
  { value: "2026-11", label: "Nov" }, { value: "2026-12", label: "Dec" },
  { value: "all", label: "All" },
];

export default async function ObjectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const selectedMonth = monthParam ?? CURRENT_MONTH;

  const { calls: allCalls } = await getCloserCalls();

  // Filter by month
  const calls = selectedMonth === "all"
    ? allCalls
    : allCalls.filter((c) => c.date.startsWith(selectedMonth));

  // Expand each call's obstacles field into individual objection entries
  type ObjEntry = { type: ObjType; overcome: boolean; cash: number; rep: string; date: string };
  const entries: ObjEntry[] = [];
  for (const call of calls) {
    if (!call.obstacles) continue;
    const parts = call.obstacles.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const type = mapObstacle(part);
      if (!type || type === "na") continue; // skip N/A and unrecognised
      entries.push({
        type,
        overcome: isOvercome(call.lead_status),
        cash: Number(call.cash_collected) || 0,
        rep: call.rep_name,
        date: call.date,
      });
    }
  }

  const totalObjections = entries.length;

  // Group by type
  const grouped: Partial<Record<ObjType, ObjEntry[]>> = {};
  for (const e of entries) {
    if (!grouped[e.type]) grouped[e.type] = [];
    grouped[e.type]!.push(e);
  }

  const breakdown = (Object.entries(grouped) as [ObjType, ObjEntry[]][])
    .map(([type, objs]) => {
      const overcome = objs.filter((o) => o.overcome);
      const revenue = overcome.reduce((s, o) => s + o.cash, 0);
      return {
        type,
        label: OBJ_LABELS[type],
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

  // Trend data — objections per day
  const trendMap: Record<string, number> = {};
  for (const e of entries) {
    trendMap[e.date] = (trendMap[e.date] ?? 0) + 1;
  }
  const trend = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Per-rep top objection
  const repObjMap: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    if (!repObjMap[e.rep]) repObjMap[e.rep] = {};
    repObjMap[e.rep][e.type] = (repObjMap[e.rep][e.type] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader
        title="Objection Intelligence"
        description="Frequency, overcome rates, and revenue impact — sourced directly from post-call forms."
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
                <div className="text-lg font-bold">{obj.label}</div>
                <div className="mt-1 text-3xl font-black">{obj.count}</div>
                <div className="text-xs text-muted-foreground">{pct(obj.pctOfTotal)} of objections</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  prev. {obj.timesOvercome} overcome
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
                    No objections logged for this period
                  </td>
                </tr>
              ) : (
                breakdown.map((row) => (
                  <tr key={row.type} className="border-b border-white/10 hover:bg-white/[0.04]">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
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
              No trend data for this period
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
          {Object.keys(repObjMap).length === 0 ? (
            <div className="text-sm text-muted-foreground">No data for this period</div>
          ) : (
            Object.entries(repObjMap).map(([repName, counts]) => {
              const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
              return (
                <div key={repName} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <span className="font-medium">{repName}</span>
                  <Badge>{top ? `${OBJ_LABELS[top[0] as ObjType] ?? titleCase(top[0])} (${top[1]})` : "No objections"}</Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Raw log */}
      <Card>
        <CardHeader>
          <CardTitle>Call Log with Objections ({calls.filter(c => c.obstacles).length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Date", "Rep", "Email", "Obstacle", "Status", "Cash"].map((h) => (
                  <th key={h} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.filter(c => c.obstacles).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No calls with objections logged for this period
                  </td>
                </tr>
              ) : (
                calls
                  .filter((c) => c.obstacles)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((c) => (
                    <tr key={c.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                      <td className="px-4 py-3">{new Date(c.date + "T00:00:00").toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-medium">{c.rep_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.lead_email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge>{c.obstacles}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className={isOvercome(c.lead_status) ? "text-emerald-400" : "text-muted-foreground"}>
                          {c.lead_status ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {Number(c.cash_collected) > 0 ? currency(Number(c.cash_collected)) : "—"}
                      </td>
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
