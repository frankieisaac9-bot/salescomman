"use client";

import { useState, useMemo } from "react";
import { DollarSign, Percent, PhoneCall, Target, TrendingUp, Users, Calendar } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import type { SetterStat } from "@/lib/types";

const BAR_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ef4444", "#06b6d4"];

const RANGES = ["MTD", "30d", "All"] as const;
type RangeFilter = (typeof RANGES)[number];

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function currency(n: number) {
  return "$" + fmt(n);
}
function pct(n: number) {
  return n.toFixed(1) + "%";
}
function shortDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getRangeSince(range: RangeFilter): string | null {
  const now = new Date();
  if (range === "MTD") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  if (range === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function sumStats(rows: SetterStat[]) {
  return rows.reduce(
    (acc, r) => ({
      new_leads: acc.new_leads + r.new_leads,
      dq: acc.dq + r.dq,
      follow_ups: acc.follow_ups + r.follow_ups,
      calls_pitched: acc.calls_pitched + r.calls_pitched,
      booked_calls: acc.booked_calls + r.booked_calls,
      calls_on_calendar: acc.calls_on_calendar + (r.calls_on_calendar ?? 0),
      calls_shown: acc.calls_shown + r.calls_shown,
      no_shows: acc.no_shows + r.no_shows,
      cancelled: acc.cancelled + r.cancelled,
      reschedules: acc.reschedules + r.reschedules,
      cash_collected: acc.cash_collected + Number(r.cash_collected),
      revenue: acc.revenue + Number(r.revenue)
    }),
    {
      new_leads: 0, dq: 0, follow_ups: 0, calls_pitched: 0,
      booked_calls: 0, calls_on_calendar: 0, calls_shown: 0, no_shows: 0, cancelled: 0,
      reschedules: 0, cash_collected: 0, revenue: 0
    }
  );
}

export function SettersClient({ stats }: { stats: SetterStat[] }) {
  const allSetterNames = useMemo(() => {
    const names = Array.from(new Set(stats.map((s) => s.setter_name))).filter(Boolean).sort();
    return names as string[];
  }, [stats]);

  const [setter, setSetter] = useState<string>("All");
  const [range, setRange] = useState<RangeFilter>("MTD");

  const filtered = useMemo(() => {
    const since = getRangeSince(range);
    return stats.filter((s) => {
      if (setter !== "All" && s.setter_name !== setter) return false;
      if (since && s.date < since) return false;
      return true;
    });
  }, [stats, setter, range]);

  const totals = useMemo(() => sumStats(filtered), [filtered]);
  const bookRate = totals.calls_pitched > 0 ? (totals.booked_calls / totals.calls_pitched) * 100 : 0;
  const showRate = totals.calls_on_calendar > 0 ? (totals.calls_shown / totals.calls_on_calendar) * 100 : 0;

  // Daily chart data — per-setter booked keys are derived from actual data
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    filtered.forEach((s) => {
      const existing = byDate.get(s.date) ?? { booked: 0, shown: 0, cash: 0 };
      existing.booked += s.booked_calls;
      existing.shown += s.calls_shown;
      existing.cash += Number(s.cash_collected);
      existing[s.setter_name] = (existing[s.setter_name] ?? 0) + s.booked_calls;
      byDate.set(s.date, existing);
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: shortDate(date),
        "Booked": v.booked,
        "Shown": v.shown,
        "Cash": v.cash,
        ...Object.fromEntries(allSetterNames.map((n) => [n, v[n] ?? 0]))
      }));
  }, [filtered, allSetterNames]);

  const comparisonRows = useMemo(() => {
    const since = getRangeSince(range);
    return allSetterNames.map((name) => {
      const rows = stats.filter((s) => s.setter_name === name && (!since || s.date >= since));
      const t = sumStats(rows);
      return {
        name,
        ...t,
        bookRate: t.calls_pitched > 0 ? (t.booked_calls / t.calls_pitched) * 100 : 0,
        showRate: t.calls_on_calendar > 0 ? (t.calls_shown / t.calls_on_calendar) * 100 : 0
      };
    });
  }, [stats, allSetterNames, range]);

  const rangeLabel = range === "MTD"
    ? new Date().toLocaleString("default", { month: "long" }) + " to date"
    : range === "30d" ? "Last 30 days" : "All time";

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {["All", ...allSetterNames].map((s) => (
            <button
              key={s}
              onClick={() => setSetter(s)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                setter === s
                  ? "bg-blue-500 text-white"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                range === r
                  ? "bg-white/15 text-white"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Booked Calls" value={fmt(totals.booked_calls)} icon={PhoneCall} tone="blue" detail={`${fmt(totals.calls_pitched)} pitched`} />
        <KpiCard label="Book Rate" value={pct(bookRate)} icon={Target} tone="gold" detail={`booked / pitched`} />
        <KpiCard label="Show Rate" value={pct(showRate)} icon={Percent} tone="green" detail={`${fmt(totals.calls_shown)} of ${fmt(totals.calls_on_calendar)} on calendar`} />
        <KpiCard label="Cash Collected" value={currency(totals.cash_collected)} icon={DollarSign} tone="gold" detail={rangeLabel} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="New Leads" value={fmt(totals.new_leads)} icon={Users} tone="blue" detail={`${fmt(totals.dq)} DQ'd`} />
        <KpiCard label="Follow Ups" value={fmt(totals.follow_ups)} icon={Calendar} tone="blue" detail="total touches" />
        <KpiCard label="Revenue" value={currency(totals.revenue)} icon={TrendingUp} tone="blue" detail={rangeLabel} />
      </div>

      {/* Charts */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {setter === "All" ? "Booked Calls by Setter" : `${setter} — Booked vs Shown`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              {setter === "All" ? (
                <BarChart data={chartData} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "#e2e8f0" }}
                    itemStyle={{ color: "#94a3b8" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  {allSetterNames.map((name, i) => (
                    <Bar key={name} dataKey={name} fill={BAR_COLORS[i % BAR_COLORS.length]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              ) : (
                <BarChart data={chartData} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "#e2e8f0" }}
                    itemStyle={{ color: "#94a3b8" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  <Bar dataKey="Booked" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Shown" fill="#10b981" radius={[3, 3, 0, 0]} />
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
                  <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  formatter={(v: number) => [currency(v), "Cash"]}
                />
                <Area type="monotone" dataKey="Cash" stroke="#f59e0b" fill="url(#cashGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Full daily data table */}
      <Card>
        <CardHeader><CardTitle>Daily Stats Log ({filtered.length} rows)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Setter","Date","New Leads","DQs","Follow-Ups","Pitched","Booked","On Calendar","Shown","No Shows","Cancelled","Reschedules","Cash","Revenue"].map(h => (
                  <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-8 text-center text-muted-foreground">No data for this filter</td></tr>
              ) : (
                [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.setter_name.localeCompare(b.setter_name)).map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{r.setter_name}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{shortDate(r.date)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.new_leads)}</td>
                    <td className="px-3 py-2.5 text-right text-red-400">{fmt(r.dq)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.follow_ups)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.calls_pitched)}</td>
                    <td className="px-3 py-2.5 text-right text-blue-300 font-medium">{fmt(r.booked_calls)}</td>
                    <td className="px-3 py-2.5 text-right text-purple-300">{fmt(r.calls_on_calendar ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-300">{fmt(r.calls_shown)}</td>
                    <td className="px-3 py-2.5 text-right text-red-400">{fmt(r.no_shows)}</td>
                    <td className="px-3 py-2.5 text-right text-yellow-400">{fmt(r.cancelled)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.reschedules)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-300 font-medium">{Number(r.cash_collected) > 0 ? currency(Number(r.cash_collected)) : "—"}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-300">{Number(r.revenue) > 0 ? currency(Number(r.revenue)) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Side-by-side comparison table */}
      {setter === "All" && (
        <Card>
          <CardHeader><CardTitle>Head-to-Head Comparison</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Setter</th>
                    <th className="pb-2 pr-4 font-medium text-right">New Leads</th>
                    <th className="pb-2 pr-4 font-medium text-right">Pitched</th>
                    <th className="pb-2 pr-4 font-medium text-right">Booked</th>
                    <th className="pb-2 pr-4 font-medium text-right">Book%</th>
                    <th className="pb-2 pr-4 font-medium text-right">Shown</th>
                    <th className="pb-2 pr-4 font-medium text-right">Show%</th>
                    <th className="pb-2 font-medium text-right">Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((r) => (
                    <tr key={r.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-semibold">{r.name}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.new_leads)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.calls_pitched)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-blue-300">{fmt(r.booked_calls)}</td>
                      <td className="py-3 pr-4 text-right text-amber-300">{pct(r.bookRate)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.calls_shown)}</td>
                      <td className="py-3 pr-4 text-right text-emerald-300">{pct(r.showRate)}</td>
                      <td className="py-3 text-right font-semibold text-amber-300">{currency(r.cash_collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
