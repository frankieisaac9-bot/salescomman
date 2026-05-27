"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { subDays } from "date-fns";
import type { DailyStat, Objection, Rep } from "@/lib/types";
import { cashByDay, countBy, repBarData } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currency } from "@/lib/utils";

const colors = ["#3b82f6", "#f59e0b", "#ef4444", "#10b981", "#a78bfa"];

export function DashboardCharts({ dailyStats, reps, objections }: { dailyStats: DailyStat[]; reps: Rep[]; objections: Objection[] }) {
  const [range, setRange] = useState(30);
  const filteredStats = useMemo(() => {
    const since = subDays(new Date(), range).toISOString().slice(0, 10);
    return dailyStats.filter((s) => s.date >= since);
  }, [dailyStats, range]);

  const revenue = cashByDay(filteredStats);
  const repBars = repBarData(filteredStats, reps);
  const objectionData = Object.entries(countBy(objections.map((objection) => objection.type))).map(([name, value]) => ({
    name: name.replaceAll("_", " "),
    value
  }));

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Revenue Over Time</CardTitle>
          <div className="flex gap-2">
            {[30, 60, 90].map((days) => (
              <Button key={days} size="sm" variant={range === days ? "default" : "outline"} onClick={() => setRange(days)}>
                {days}d
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenue}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" />
              <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
              <YAxis stroke="#94a3b8" tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => currency(Number(value))} contentStyle={{ background: "#151925", border: "1px solid rgba(255,255,255,.12)" }} />
              <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Objection Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={objectionData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={105} paddingAngle={4}>
                {objectionData.map((_, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#151925", border: "1px solid rgba(255,255,255,.12)" }} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="xl:col-span-5">
        <CardHeader>
          <CardTitle>Booked vs Closed Per Rep</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={repBars}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" />
              <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 12 }} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#151925", border: "1px solid rgba(255,255,255,.12)" }} />
              <Bar dataKey="booked" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="closed" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
