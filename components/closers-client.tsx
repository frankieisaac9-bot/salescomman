"use client";

import { useState, useMemo } from "react";
import { DollarSign, Percent, PhoneCall, Target, TrendingUp, ExternalLink } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import type { CloserCall, DailyStat } from "@/lib/types";

const MONTHS = [
  { value: "2026-01", label: "Jan" }, { value: "2026-02", label: "Feb" },
  { value: "2026-03", label: "Mar" }, { value: "2026-04", label: "Apr" },
  { value: "2026-05", label: "May" }, { value: "2026-06", label: "Jun" },
  { value: "2026-07", label: "Jul" }, { value: "2026-08", label: "Aug" },
  { value: "2026-09", label: "Sep" }, { value: "2026-10", label: "Oct" },
  { value: "2026-11", label: "Nov" }, { value: "2026-12", label: "Dec" },
  { value: "all", label: "All" },
];
const now = new Date();
const CURRENT_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const REP_COLORS: Record<string, string> = { Dawid: "#3b82f6", James: "#ef4444" };

function fmt(n: number) { return n.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function currency(n: number) { return "$" + fmt(n); }
function pct(n: number) { return n.toFixed(1) + "%"; }
function shortDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function getMonthRange(month: string): { start: string; end: string } | null {
  if (month === "all") return null;
  const [year, m] = month.split("-").map(Number);
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const end = `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}
function monthLabel(month: string): string {
  if (month === "all") return "All time";
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function statusColor(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("closed") || s.includes("deposit")) return "text-emerald-400 bg-emerald-400/10";
  if (s.includes("no show")) return "text-red-400 bg-red-400/10";
  if (s.includes("not financially") || s.includes("bad fit")) return "text-orange-400 bg-orange-400/10";
  if (s.includes("follow up") || s.includes("short") || s.includes("long")) return "text-blue-400 bg-blue-400/10";
  if (s.includes("rescheduling") || s.includes("cancel")) return "text-yellow-400 bg-yellow-400/10";
  return "text-slate-400 bg-slate-400/10";
}

export function ClosersClient({ calls, stats }: { calls: CloserCall[]; stats: DailyStat[] }) {
  // "Downsells" is a revenue tab, not a rep — include in totals but exclude from filter/comparison
  const repNames = useMemo(() => {
    const names = Array.from(new Set(stats.map(s => s.rep_name).filter(n => Boolean(n) && n !== "Downsells"))) as string[];
    return ["All", ...names.sort()];
  }, [stats]);

  const [rep, setRep] = useState<string>("All");
  const [month, setMonth] = useState<string>(CURRENT_MONTH);
  const [search, setSearch] = useState("");

  // Filter tracking stats
  const filteredStats = useMemo(() => {
    const range = getMonthRange(month);
    return stats.filter(s => {
      if (rep !== "All" && s.rep_name !== rep) return false;
      if (range && (s.date < range.start || s.date > range.end)) return false;
      return true;
    });
  }, [stats, rep, month]);

  // Aggregate KPIs from tracking sheet (source of truth)
  const totals = useMemo(() => filteredStats.reduce((acc, s) => ({
    available: acc.available + s.available,
    booked: acc.booked + s.booked,
    showed: acc.showed + s.showed,
    canceled: acc.canceled + s.canceled,
    no_show: acc.no_show + s.no_show,
    offer: acc.offer + s.offer,
    deposit: acc.deposit + s.deposit,
    closed: acc.closed + s.closed,
    cash: acc.cash + Number(s.cash_collected),
    revenue: acc.revenue + Number(s.rev_generated),
  }), { available: 0, booked: 0, showed: 0, canceled: 0, no_show: 0, offer: 0, deposit: 0, closed: 0, cash: 0, revenue: 0 }), [filteredStats]);

  const showRate = totals.booked > 0 ? (totals.showed / totals.booked) * 100 : 0;
  const closeRate = totals.showed > 0 ? (totals.closed / totals.showed) * 100 : 0;
  const offerRate = totals.showed > 0 ? (totals.offer / totals.showed) * 100 : 0;

  const rangeLabel = monthLabel(month);

  // Chart — daily data from tracking sheet
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    filteredStats.forEach(s => {
      const e = byDate.get(s.date) ?? { booked: 0, showed: 0, closed: 0, cash: 0 };
      e.booked += s.booked;
      e.showed += s.showed;
      e.closed += s.closed;
      e.cash += Number(s.cash_collected);
      if (s.rep_name) e[s.rep_name] = (e[s.rep_name] ?? 0) + s.booked;
      byDate.set(s.date, e);
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: shortDate(date), ...v }));
  }, [filteredStats]);

  // Rep comparison from tracking sheet
  const repRows = useMemo(() => {
    const range = getMonthRange(month);
    return repNames.filter(r => r !== "All").map(name => {
      const rows = stats.filter(s => s.rep_name === name && (!range || (s.date >= range.start && s.date <= range.end)));
      const t = rows.reduce((a, s) => ({
        booked: a.booked + s.booked, showed: a.showed + s.showed,
        closed: a.closed + s.closed, offer: a.offer + s.offer,
        cash: a.cash + Number(s.cash_collected), revenue: a.revenue + Number(s.rev_generated),
        no_show: a.no_show + s.no_show, canceled: a.canceled + s.canceled,
      }), { booked: 0, showed: 0, closed: 0, offer: 0, cash: 0, revenue: 0, no_show: 0, canceled: 0 });
      return {
        name,
        ...t,
        showRate: t.booked > 0 ? (t.showed / t.booked) * 100 : 0,
        closeRate: t.showed > 0 ? (t.closed / t.showed) * 100 : 0,
      };
    });
  }, [stats, repNames, month]);

  // Call log from post-call form (detail only)
  const logRows = useMemo(() => {
    const range = getMonthRange(month);
    const q = search.toLowerCase();
    return calls
      .filter(c => {
        if (rep !== "All" && c.rep_name !== rep) return false;
        if (range && (c.date < range.start || c.date > range.end)) return false;
        if (q && ![c.rep_name, c.lead_email, c.setter, c.lead_status, c.problem]
          .some(f => (f ?? "").toLowerCase().includes(q))) return false;
        return true;
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [calls, rep, month, search]);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {repNames.map(r => (
            <button key={r} onClick={() => setRep(r)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${rep === r ? "bg-blue-500 text-white" : "text-slate-300 hover:text-white hover:bg-white/10"}`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {MONTHS.map(m => {
            const future = m.value !== "all" && m.value > CURRENT_MONTH;
            return (
              <button
                key={m.value}
                onClick={() => !future && setMonth(m.value)}
                disabled={future}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  month === m.value ? "bg-white/15 text-white" :
                  future ? "text-slate-600 cursor-not-allowed" :
                  "text-slate-300 hover:text-white hover:bg-white/10"
                }`}>
                {m.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">{rangeLabel} · stats from tracking sheet</span>
      </div>

      {/* KPI Cards — from tracking sheet */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Booked" value={fmt(totals.booked)} icon={PhoneCall} tone="blue" detail={`${fmt(totals.available)} slots available`} />
        <KpiCard label="Show Rate" value={pct(showRate)} icon={Target} tone="gold" detail={`${fmt(totals.showed)} showed of ${fmt(totals.booked)}`} />
        <KpiCard label="Close Rate" value={pct(closeRate)} icon={Percent} tone="green" detail={`${fmt(totals.closed)} closed of ${fmt(totals.showed)} shown`} />
        <KpiCard label="Cash Collected" value={currency(totals.cash)} icon={DollarSign} tone="gold" detail={rangeLabel} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Revenue Generated" value={currency(totals.revenue)} icon={TrendingUp} tone="blue" detail={rangeLabel} />
        <KpiCard label="Offers Made" value={fmt(totals.offer)} icon={Target} tone="blue" detail={`${pct(offerRate)} of shows`} />
        <KpiCard label="No Shows" value={fmt(totals.no_show)} icon={PhoneCall} tone="blue" detail={`${fmt(totals.canceled)} cancelled`} />
        <KpiCard label="Closed + Deposits" value={fmt(totals.closed + totals.deposit)} icon={DollarSign} tone="green" detail={`${fmt(totals.deposit)} deposits`} />
      </div>

      {/* Charts */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{rep === "All" ? "Booked Calls by Rep" : `${rep} — Booked vs Showed vs Closed`}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              {rep === "All" ? (
                <BarChart data={chartData} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  {repNames.filter(r => r !== "All").map(r => (
                    <Bar key={r} dataKey={r} fill={REP_COLORS[r] ?? "#8b5cf6"} radius={[3, 3, 0, 0]} stackId="a" />
                  ))}
                </BarChart>
              ) : (
                <BarChart data={chartData} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  <Bar dataKey="booked" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Booked" />
                  <Bar dataKey="showed" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Showed" />
                  <Bar dataKey="closed" fill="#10b981" radius={[3, 3, 0, 0]} name="Closed" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cash Collected Over Time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="closerCashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} formatter={(v: number) => [currency(v), "Cash"]} />
                <Area type="monotone" dataKey="cash" stroke="#f59e0b" fill="url(#closerCashGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Head-to-head */}
      {rep === "All" && (
        <Card>
          <CardHeader><CardTitle>Head-to-Head Comparison</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Rep</th>
                    <th className="pb-2 pr-4 font-medium text-right">Booked</th>
                    <th className="pb-2 pr-4 font-medium text-right">Showed</th>
                    <th className="pb-2 pr-4 font-medium text-right">Show%</th>
                    <th className="pb-2 pr-4 font-medium text-right">Closed</th>
                    <th className="pb-2 pr-4 font-medium text-right">Close%</th>
                    <th className="pb-2 pr-4 font-medium text-right">Offers</th>
                    <th className="pb-2 pr-4 font-medium text-right">No Show</th>
                    <th className="pb-2 pr-4 font-medium text-right">Cash</th>
                    <th className="pb-2 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {repRows.map(r => (
                    <tr key={r.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-semibold" style={{ color: REP_COLORS[r.name] }}>{r.name}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.booked)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.showed)}</td>
                      <td className="py-3 pr-4 text-right text-blue-300">{pct(r.showRate)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-300">{fmt(r.closed)}</td>
                      <td className="py-3 pr-4 text-right text-emerald-300">{pct(r.closeRate)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.offer)}</td>
                      <td className="py-3 pr-4 text-right text-red-300">{fmt(r.no_show)}</td>
                      <td className="py-3 pr-4 text-right text-amber-300">{currency(r.cash)}</td>
                      <td className="py-3 text-right text-emerald-300">{currency(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Call Log — from post-call forms */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Call Log ({logRows.length})</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">From post-call forms</p>
            </div>
            <input
              placeholder="Search rep, email, status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-64 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-muted-foreground text-xs">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Rep</th>
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Source / Setter</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Offer</th>
                  <th className="pb-2 pr-3 font-medium">Problem</th>
                  <th className="pb-2 pr-3 font-medium">Goal</th>
                  <th className="pb-2 pr-3 font-medium">Obstacles</th>
                  <th className="pb-2 pr-3 font-medium">Job</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cash</th>
                  <th className="pb-2 pr-3 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium">Recording</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map(c => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-300">{shortDate(c.date)}</td>
                    <td className="py-2.5 pr-3 font-medium whitespace-nowrap" style={{ color: REP_COLORS[c.rep_name] ?? undefined }}>{c.rep_name}</td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[140px] truncate">{c.lead_email ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{c.setter || "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(c.lead_status)}`}>
                        {c.lead_status ?? "—"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-xs font-medium ${c.offer_made ? "text-emerald-400" : "text-slate-500"}`}>
                        {c.offer_made ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]"><span className="line-clamp-2">{c.problem ?? "—"}</span></td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]"><span className="line-clamp-2">{c.goal ?? "—"}</span></td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]"><span className="line-clamp-2">{c.obstacles ?? "—"}</span></td>
                    <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{c.prospect_job ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-medium text-amber-300">{c.cash_collected > 0 ? currency(Number(c.cash_collected)) : "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-medium text-emerald-300">{c.revenue > 0 ? currency(Number(c.revenue)) : "—"}</td>
                    <td className="py-2.5">
                      {c.call_recording_url && c.call_recording_url !== "NA" ? (
                        <a href={c.call_recording_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs">
                          <ExternalLink className="h-3 w-3" /> View
                        </a>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logRows.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No calls found for this filter.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
