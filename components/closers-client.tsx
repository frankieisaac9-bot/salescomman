"use client";

import { useState, useMemo } from "react";
import { DollarSign, Percent, PhoneCall, Target, TrendingUp, ExternalLink } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import type { CloserCall } from "@/lib/types";

const RANGES = ["MTD", "30d", "All"] as const;
type RangeFilter = (typeof RANGES)[number];

function fmt(n: number) { return n.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function currency(n: number) { return "$" + fmt(n); }
function pct(n: number) { return n.toFixed(1) + "%"; }
function shortDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getRangeSince(range: RangeFilter): string | null {
  const now = new Date();
  if (range === "MTD") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (range === "30d") { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }
  return null;
}

function isShowed(c: CloserCall) {
  const s = (c.lead_status ?? "").toLowerCase();
  return !s.includes("no show") && !s.includes("rescheduling") && !s.includes("reschedul");
}
function isClosed(c: CloserCall) {
  const s = (c.lead_status ?? "").toLowerCase();
  return s.includes("closed") || s.includes("deposit");
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

export function ClosersClient({ calls }: { calls: CloserCall[] }) {
  const repNames = useMemo(() => {
    const names = [...new Set(calls.map(c => c.rep_name))].sort();
    return ["All", ...names];
  }, [calls]);

  const [rep, setRep] = useState<string>("All");
  const [range, setRange] = useState<RangeFilter>("MTD");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const since = getRangeSince(range);
    return calls.filter(c => {
      if (rep !== "All" && c.rep_name !== rep) return false;
      if (since && c.date < since) return false;
      return true;
    });
  }, [calls, rep, range]);

  const total = filtered.length;
  const showed = filtered.filter(isShowed).length;
  const closed = filtered.filter(isClosed).length;
  const showRate = total > 0 ? (showed / total) * 100 : 0;
  const closeRate = showed > 0 ? (closed / showed) * 100 : 0;
  const cashTotal = filtered.reduce((s, c) => s + Number(c.cash_collected), 0);
  const revenueTotal = filtered.reduce((s, c) => s + Number(c.revenue), 0);

  const rangeLabel = range === "MTD"
    ? new Date().toLocaleString("default", { month: "long" }) + " to date"
    : range === "30d" ? "Last 30 days" : "All time";

  // Chart data — calls + cash by date
  const chartData = useMemo(() => {
    const byDate = new Map<string, { calls: number; closed: number; cash: number; [key: string]: number }>();
    filtered.forEach(c => {
      const e = byDate.get(c.date) ?? { calls: 0, closed: 0, cash: 0 };
      e.calls++;
      if (isClosed(c)) e.closed++;
      e.cash += Number(c.cash_collected);
      // per-rep breakdown
      const key = c.rep_name;
      e[key] = (e[key] ?? 0) + 1;
      byDate.set(c.date, e);
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: shortDate(date), ...v }));
  }, [filtered]);

  // Rep comparison
  const repRows = useMemo(() => {
    const since = getRangeSince(range);
    return repNames.filter(r => r !== "All").map(name => {
      const rows = calls.filter(c => c.rep_name === name && (!since || c.date >= since));
      const t = rows.length;
      const sh = rows.filter(isShowed).length;
      const cl = rows.filter(isClosed).length;
      return {
        name,
        total: t,
        showed: sh,
        closed: cl,
        showRate: t > 0 ? (sh / t) * 100 : 0,
        closeRate: sh > 0 ? (cl / sh) * 100 : 0,
        cash: rows.reduce((s, c) => s + Number(c.cash_collected), 0),
        revenue: rows.reduce((s, c) => s + Number(c.revenue), 0),
      };
    });
  }, [calls, repNames, range]);

  // Call log with search
  const logRows = useMemo(() => {
    const q = search.toLowerCase();
    return filtered
      .filter(c => !q || [c.rep_name, c.lead_email, c.setter, c.lead_status, c.problem]
        .some(f => (f ?? "").toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filtered, search]);

  const REP_COLORS: Record<string, string> = {
    Dawid: "#3b82f6",
    James: "#ef4444",
    Ben: "#f59e0b",
  };

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
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${range === r ? "bg-white/15 text-white" : "text-slate-300 hover:text-white hover:bg-white/10"}`}>
              {r}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Calls Logged" value={fmt(total)} icon={PhoneCall} tone="blue" detail={`${fmt(showed)} showed up`} />
        <KpiCard label="Show Rate" value={pct(showRate)} icon={Target} tone="gold" detail={`${fmt(showed)} of ${fmt(total)}`} />
        <KpiCard label="Close Rate" value={pct(closeRate)} icon={Percent} tone="green" detail={`${fmt(closed)} closed`} />
        <KpiCard label="Cash Collected" value={currency(cashTotal)} icon={DollarSign} tone="gold" detail={rangeLabel} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard label="Revenue Generated" value={currency(revenueTotal)} icon={TrendingUp} tone="blue" detail={rangeLabel} />
        <KpiCard label="Offers Made" value={fmt(filtered.filter(c => c.offer_made).length)} icon={Target} tone="blue"
          detail={`${pct(total > 0 ? (filtered.filter(c => c.offer_made).length / total) * 100 : 0)} of calls`} />
      </div>

      {/* Charts */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{rep === "All" ? "Calls by Rep" : `${rep} — Calls vs Closed`}</CardTitle>
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
                <BarChart data={chartData} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  <Bar dataKey="calls" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Calls" />
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
                    <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                    <th className="pb-2 pr-4 font-medium text-right">Showed</th>
                    <th className="pb-2 pr-4 font-medium text-right">Show%</th>
                    <th className="pb-2 pr-4 font-medium text-right">Closed</th>
                    <th className="pb-2 pr-4 font-medium text-right">Close%</th>
                    <th className="pb-2 pr-4 font-medium text-right">Offers</th>
                    <th className="pb-2 font-medium text-right">Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {repRows.map(r => (
                    <tr key={r.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-semibold" style={{ color: REP_COLORS[r.name] ?? undefined }}>{r.name}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.total)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(r.showed)}</td>
                      <td className="py-3 pr-4 text-right text-blue-300">{pct(r.showRate)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-300">{fmt(r.closed)}</td>
                      <td className="py-3 pr-4 text-right text-emerald-300">{pct(r.closeRate)}</td>
                      <td className="py-3 pr-4 text-right">{fmt(calls.filter(c => c.rep_name === r.name && c.offer_made && (!getRangeSince(range) || c.date >= (getRangeSince(range) ?? ""))).length)}</td>
                      <td className="py-3 text-right font-semibold text-amber-300">{currency(r.cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Call Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Call Log ({logRows.length})</CardTitle>
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
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]">
                      <span className="line-clamp-2">{c.problem ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]">
                      <span className="line-clamp-2">{c.goal ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400 max-w-[160px]">
                      <span className="line-clamp-2">{c.obstacles ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{c.prospect_job ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-medium text-amber-300">
                      {c.cash_collected > 0 ? currency(Number(c.cash_collected)) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-emerald-300">
                      {c.revenue > 0 ? currency(Number(c.revenue)) : "—"}
                    </td>
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
