import type { Call, DailyStat, Objection, Rep, RepMetrics } from "@/lib/types";

export function calculateGlobalMetrics(calls: Call[]) {
  // Every row from the post-call form = one booked appointment slot
  const totalBooked = calls.length;
  const showed = calls.filter((call) => call.status === "showed" || call.status === "closed").length;
  const noShow = calls.filter((call) => call.status === "no_show").length;
  const closed = calls.filter((call) => call.status === "closed").length;
  const cash = calls
    .filter((call) => call.status === "closed")
    .reduce((sum, call) => sum + Number(call.cash_collected ?? 0), 0);
  const revenue = calls
    .filter((call) => call.status === "closed")
    .reduce((sum, call) => sum + Number(call.revenue_generated ?? 0), 0);

  return {
    callsBooked: totalBooked,
    showed,
    noShow,
    callsClosed: closed,
    // Show% = Showed / Booked (user formula: 60/133 = 45.11%)
    showRate: totalBooked ? (showed / totalBooked) * 100 : 0,
    // Close% = Closed / Showed (user formula: 20/60 = 33.33%)
    closeRate: showed ? (closed / showed) * 100 : 0,
    cashCollected: cash,
    revenueGenerated: revenue
  };
}

export function calculateRepMetrics(reps: Rep[], calls: Call[], objections: Objection[]): RepMetrics[] {
  return reps.map((rep) => {
    const repCalls = calls.filter((call) => call.rep_id === rep.id);
    const base = calculateGlobalMetrics(repCalls);
    const repObjections = objections.filter((objection) => objection.rep_id === rep.id);
    const objectionCounts = countBy(repObjections.map((objection) => objection.type));
    const topObjection = Object.entries(objectionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    const productBreakdown = countBy(
      repCalls.filter((call) => call.status === "closed").map((call) => call.product_offered ?? "Unknown")
    );

    return {
      rep,
      ...base,
      topObjection,
      productBreakdown
    };
  });
}

export function calculateMetricsFromDailyStats(stats: DailyStat[]) {
  const booked = stats.reduce((s, r) => s + r.booked, 0);
  const showed = stats.reduce((s, r) => s + r.showed, 0);
  const closed = stats.reduce((s, r) => s + r.closed, 0);
  const cashCollected = stats.reduce((s, r) => s + Number(r.cash_collected), 0);
  const revenueGenerated = stats.reduce((s, r) => s + Number(r.rev_generated), 0);
  return {
    callsBooked: booked,
    showed,
    callsClosed: closed,
    showRate: booked > 0 ? (showed / booked) * 100 : 0,
    closeRate: showed > 0 ? (closed / showed) * 100 : 0,
    cashCollected,
    revenueGenerated
  };
}

export function cashByDay(stats: DailyStat[]) {
  const result = stats.reduce<Record<string, number>>((acc, stat) => {
    acc[stat.date] = (acc[stat.date] ?? 0) + Number(stat.cash_collected);
    return acc;
  }, {});
  return Object.entries(result)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Group by rep_name from the tracking sheet — works even when the reps table
// is empty or rep_id is null. "Downsells" is a revenue tab, not a rep.
export function repBarData(stats: DailyStat[]) {
  const byName = new Map<string, { booked: number; closed: number }>();
  for (const s of stats) {
    const name = s.rep_name?.trim();
    if (!name || name === "Downsells") continue;
    const e = byName.get(name) ?? { booked: 0, closed: 0 };
    e.booked += s.booked;
    e.closed += s.closed;
    byName.set(name, e);
  }
  return Array.from(byName.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, v]) => ({ name, ...v }));
}

export function countBy(items: string[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

export function objectionsByDay(objections: Objection[]) {
  const result = objections.reduce<Record<string, number>>((acc, obj) => {
    const day = obj.created_at.slice(0, 10);
    acc[day] = (acc[day] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(result)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function revenueByDay(calls: Call[]) {
  const result = calls
    .filter((call) => call.status === "closed")
    .reduce<Record<string, number>>((acc, call) => {
      const day = call.call_date.slice(0, 10);
      // Use cash_collected first, fall back to revenue_generated
      acc[day] = (acc[day] ?? 0) + (Number(call.cash_collected ?? 0) || Number(call.revenue_generated ?? 0));
      return acc;
    }, {});

  return Object.entries(result)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
