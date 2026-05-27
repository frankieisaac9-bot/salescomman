"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Crown, Medal } from "lucide-react";
import { subDays, startOfWeek, startOfMonth } from "date-fns";
import type { Call, Objection, Rep } from "@/lib/types";
import { calculateRepMetrics } from "@/lib/metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { currency, percent } from "@/lib/utils";

const periods = ["This week", "This month", "All time"] as const;
type Period = (typeof periods)[number];

function filterCallsByPeriod(calls: Call[], period: Period): Call[] {
  const now = new Date();
  if (period === "This week") {
    const start = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
    return calls.filter((c) => c.call_date >= start);
  }
  if (period === "This month") {
    const start = startOfMonth(now).toISOString();
    return calls.filter((c) => c.call_date >= start);
  }
  return calls;
}

export function LeaderboardClient({
  reps,
  calls,
  objections,
  products,
  teams
}: {
  reps: Rep[];
  calls: Call[];
  objections: Objection[];
  products: string[];
  teams: string[];
}) {
  const [period, setPeriod] = useState<Period>("All time");
  const [product, setProduct] = useState<string>("All");
  const [team, setTeam] = useState<string>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let c = filterCallsByPeriod(calls, period);
    if (product !== "All") c = c.filter((call) => call.product_offered === product);
    return c;
  }, [calls, period, product]);

  const filteredReps = useMemo(() => {
    if (team === "All") return reps;
    return reps.filter((rep) => rep.team === team);
  }, [reps, team]);

  const rows = useMemo(
    () =>
      calculateRepMetrics(filteredReps, filtered, objections).sort(
        (a, b) => b.revenueGenerated - a.revenueGenerated
      ),
    [filteredReps, filtered, objections]
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {periods.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "outline"}
            onClick={() => setPeriod(p)}
          >
            {p}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="All">All Products</option>
            {products.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {teams.length > 0 && (
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="All">All Teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {[
                  "Rank",
                  "Rep Name",
                  "Calls Booked",
                  "Show Rate",
                  "Calls Closed",
                  "Close Rate",
                  "Cash Collected",
                  "Revenue",
                  "Top Objection",
                  ""
                ].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <>
                  <motion.tr
                    key={row.rep?.id ?? index}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b border-white/10 transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 font-black">
                        {index === 0 ? (
                          <Medal className="h-4 w-4 text-command-gold" />
                        ) : index === 1 ? (
                          <Medal className="h-4 w-4 text-slate-300" />
                        ) : index === 2 ? (
                          <Medal className="h-4 w-4 text-amber-700" />
                        ) : null}
                        #{index + 1}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/15 font-bold text-blue-200">
                          {row.rep?.name.slice(0, 2).toUpperCase() ?? "NA"}
                        </div>
                        <div>
                          <div className="font-semibold">{row.rep?.name ?? "Unknown"}</div>
                          <div className="text-xs text-muted-foreground">{row.rep?.team ?? "No team"}</div>
                        </div>
                        {index === 0 ? <Crown className="h-4 w-4 text-command-gold" /> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">{row.callsBooked}</td>
                    <td className="px-4 py-4">{percent(row.showRate)}</td>
                    <td className="px-4 py-4">{row.callsClosed}</td>
                    <td className="px-4 py-4">{percent(row.closeRate)}</td>
                    <td className="px-4 py-4">{currency(row.cashCollected)}</td>
                    <td className="px-4 py-4 font-bold text-command-gold">{currency(row.revenueGenerated)}</td>
                    <td className="px-4 py-4">
                      <Badge>{row.topObjection.replaceAll("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setExpanded(expanded === row.rep?.id ? null : (row.rep?.id ?? null))}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${expanded === row.rep?.id ? "rotate-180" : ""}`}
                        />
                        Details
                      </button>
                    </td>
                  </motion.tr>
                  <AnimatePresence>
                    {expanded === row.rep?.id && (
                      <motion.tr
                        key={`${row.rep?.id}-expanded`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <td colSpan={10} className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Product Mix</div>
                              {Object.entries(row.productBreakdown).length ? (
                                Object.entries(row.productBreakdown).map(([prod, count]) => (
                                  <div key={prod} className="flex items-center justify-between text-sm">
                                    <span>{prod}</span>
                                    <Badge variant="muted">{count} closed</Badge>
                                  </div>
                                ))
                              ) : (
                                <div className="text-sm text-muted-foreground">No closed deals</div>
                              )}
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Objection Breakdown</div>
                              {(() => {
                                const repObjs = objections.filter((o) => o.rep_id === row.rep?.id);
                                const counts: Record<string, number> = {};
                                repObjs.forEach((o) => { counts[o.type] = (counts[o.type] ?? 0) + 1; });
                                const entries = Object.entries(counts);
                                return entries.length ? (
                                  entries.sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                                    <div key={type} className="flex items-center justify-between text-sm">
                                      <span className="capitalize">{type.replaceAll("_", " ")}</span>
                                      <Badge variant="muted">{count}x</Badge>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-muted-foreground">None logged</div>
                                );
                              })()}
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recent Calls</div>
                              {calls
                                .filter((c) => c.rep_id === row.rep?.id)
                                .sort((a, b) => b.call_date.localeCompare(a.call_date))
                                .slice(0, 4)
                                .map((c) => (
                                  <div key={c.id} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{new Date(c.call_date).toLocaleDateString()}</span>
                                    <Badge variant={c.status === "closed" ? "gold" : "muted"}>
                                      {c.status.replace("_", " ")}
                                    </Badge>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
