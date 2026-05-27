import { ObjectionChart } from "@/components/objection-chart";
import { ObjectionTrendChart } from "@/components/objection-trend-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getObjectionsData } from "@/lib/data";
import { countBy, objectionsByDay } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export default async function ObjectionsPage() {
  const { objections, reps } = await getObjectionsData();
  const data = Object.entries(countBy(objections.map((o) => o.type))).map(([name, value]) => ({
    name: name.replaceAll("_", " "),
    value
  }));
  const trend = objectionsByDay(objections);

  return (
    <>
      <PageHeader
        title="Objection Intelligence"
        description="Frequency, per-rep patterns, trend direction, and the raw notes behind every objection logged on calls."
      />
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Objection Frequency</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ObjectionChart data={data} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Per-Rep Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reps.length === 0 ? (
              <div className="text-sm text-muted-foreground">No rep data yet</div>
            ) : (
              reps.map((rep) => {
                const counts = countBy(
                  objections.filter((o) => o.rep_id === rep.id).map((o) => o.type)
                );
                const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                return (
                  <div
                    key={rep.id}
                    className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] p-3"
                  >
                    <span className="font-medium">{rep.name}</span>
                    <Badge>
                      {top ? `${top[0].replaceAll("_", " ")} (${top[1]})` : "No objections"}
                    </Badge>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
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

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Logged Objections</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Date", "Rep", "Type", "Call Date", "Notes"].map((heading) => (
                  <th key={heading} className="px-4 py-3">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {objections.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No objections logged yet
                  </td>
                </tr>
              ) : (
                objections.map((objection) => (
                  <tr key={objection.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                    <td className="px-4 py-4">{new Date(objection.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-4">{objection.reps?.name ?? "Unassigned"}</td>
                    <td className="px-4 py-4">
                      <Badge>{objection.type.replaceAll("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      {objection.calls?.call_date
                        ? new Date(objection.calls.call_date).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{objection.notes ?? "-"}</td>
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
