"use client";

import { Fragment, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Crown, Medal } from "lucide-react";
import type { CloserCall, DailyStat, SetterStat } from "@/lib/types";
import { buildMonthOptions, mapObstacle, OBJ_LABELS } from "@/lib/objections";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { currency, percent } from "@/lib/utils";

const MONTHS = buildMonthOptions();
const now = new Date();
const CURRENT_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const BOARDS = ["Closers", "Setters"] as const;
type Board = (typeof BOARDS)[number];

function inMonth(date: string, month: string): boolean {
  return month === "all" || date.startsWith(month);
}

function RankCell({ index }: { index: number }) {
  return (
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
  );
}

function NameCell({ name, isFirst }: { name: string; isFirst: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/15 font-bold text-blue-200">
        {name.slice(0, 2).toUpperCase()}
      </div>
      <div className="font-semibold">{name}</div>
      {isFirst ? <Crown className="h-4 w-4 text-command-gold" /> : null}
    </div>
  );
}

export function LeaderboardClient({
  stats,
  setterStats,
  closerCalls
}: {
  stats: DailyStat[];
  setterStats: SetterStat[];
  closerCalls: CloserCall[];
}) {
  const [board, setBoard] = useState<Board>("Closers");
  const [month, setMonth] = useState<string>(CURRENT_MONTH);
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Closers board — from tracking sheet daily_stats ────────────
  const closerRows = useMemo(() => {
    const byName = new Map<string, { booked: number; showed: number; closed: number; offer: number; cash: number; revenue: number }>();
    for (const s of stats) {
      const name = s.rep_name?.trim();
      if (!name || name === "Downsells" || !inMonth(s.date, month)) continue;
      const e = byName.get(name) ?? { booked: 0, showed: 0, closed: 0, offer: 0, cash: 0, revenue: 0 };
      e.booked += s.booked;
      e.showed += s.showed;
      e.closed += s.closed;
      e.offer += s.offer;
      e.cash += Number(s.cash_collected);
      e.revenue += Number(s.rev_generated);
      byName.set(name, e);
    }
    return Array.from(byName.entries())
      .map(([name, t]) => ({
        name,
        ...t,
        showRate: t.booked > 0 ? (t.showed / t.booked) * 100 : 0,
        closeRate: t.showed > 0 ? (t.closed / t.showed) * 100 : 0,
      }))
      .sort((a, b) => b.cash - a.cash || b.closed - a.closed);
  }, [stats, month]);

  // Post-call form calls per closer (for top objection + expandable detail)
  const callsByCloser = useMemo(() => {
    const map = new Map<string, CloserCall[]>();
    for (const c of closerCalls) {
      if (!inMonth(c.date, month)) continue;
      const key = c.rep_name.trim().toLowerCase();
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [closerCalls, month]);

  const closerDetail = (name: string) => {
    // Loose first-name match: tracking sheet uses "Dawid", form may say "Dawid K"
    const q = name.trim().toLowerCase();
    for (const [key, list] of Array.from(callsByCloser.entries())) {
      if (key.includes(q) || q.includes(key)) return list;
    }
    return [] as CloserCall[];
  };

  const topObjection = (name: string): string => {
    const counts: Record<string, number> = {};
    for (const c of closerDetail(name)) {
      const t = mapObstacle(c.obstacles ?? "");
      if (!t || t === "na") continue;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? OBJ_LABELS[top[0] as keyof typeof OBJ_LABELS] : "none";
  };

  // ── Setters board — from setter_stats ──────────────────────────
  const setterRows = useMemo(() => {
    const byName = new Map<string, { pitched: number; booked: number; onCal: number; shown: number; newLeads: number; cash: number }>();
    for (const s of setterStats) {
      const name = s.setter_name?.trim();
      if (!name || !inMonth(s.date, month)) continue;
      const e = byName.get(name) ?? { pitched: 0, booked: 0, onCal: 0, shown: 0, newLeads: 0, cash: 0 };
      e.pitched += s.calls_pitched;
      e.booked += s.booked_calls;
      e.onCal += s.calls_on_calendar ?? 0;
      e.shown += s.calls_shown;
      e.newLeads += s.new_leads;
      e.cash += Number(s.cash_collected);
      byName.set(name, e);
    }
    return Array.from(byName.entries())
      .map(([name, t]) => ({
        name,
        ...t,
        bookRate: t.pitched > 0 ? (t.booked / t.pitched) * 100 : 0,
        showRate: t.onCal > 0 ? (t.shown / t.onCal) * 100 : 0,
      }))
      .sort((a, b) => b.booked - a.booked || b.shown - a.shown);
  }, [setterStats, month]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {BOARDS.map((b) => (
            <button
              key={b}
              onClick={() => setBoard(b)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                board === b ? "bg-blue-500 text-white" : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap rounded-lg border border-white/10 bg-white/[0.03] p-1 gap-1">
          {MONTHS.map((m) => {
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
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {board === "Closers" ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {["Rank", "Rep", "Booked", "Show Rate", "Closed", "Close Rate", "Offers", "Cash Collected", "Revenue", "Top Objection", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closerRows.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">No tracking data for this period</td></tr>
                ) : (
                  closerRows.map((row, index) => {
                    const detail = closerDetail(row.name);
                    return (
                      <Fragment key={row.name}>
                        <motion.tr
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="border-b border-white/10 transition-colors hover:bg-white/[0.04]"
                        >
                          <td className="px-4 py-4"><RankCell index={index} /></td>
                          <td className="px-4 py-4"><NameCell name={row.name} isFirst={index === 0} /></td>
                          <td className="px-4 py-4">{row.booked}</td>
                          <td className="px-4 py-4">{percent(row.showRate)}</td>
                          <td className="px-4 py-4">{row.closed}</td>
                          <td className="px-4 py-4">{percent(row.closeRate)}</td>
                          <td className="px-4 py-4">{row.offer}</td>
                          <td className="px-4 py-4 font-bold text-command-gold">{currency(row.cash)}</td>
                          <td className="px-4 py-4">{currency(row.revenue)}</td>
                          <td className="px-4 py-4"><Badge>{topObjection(row.name)}</Badge></td>
                          <td className="px-4 py-4">
                            {detail.length > 0 && (
                              <button
                                onClick={() => setExpanded(expanded === row.name ? null : row.name)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
                              >
                                <ChevronDown className={`h-3 w-3 transition-transform ${expanded === row.name ? "rotate-180" : ""}`} />
                                Details
                              </button>
                            )}
                          </td>
                        </motion.tr>
                        <AnimatePresence>
                          {expanded === row.name && (
                            <motion.tr
                              key={`${row.name}-expanded`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <td colSpan={11} className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div>
                                    <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Objection Breakdown</div>
                                    {(() => {
                                      const counts: Record<string, number> = {};
                                      for (const c of detail) {
                                        const t = mapObstacle(c.obstacles ?? "");
                                        if (!t || t === "na") continue;
                                        counts[t] = (counts[t] ?? 0) + 1;
                                      }
                                      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                                      return entries.length ? (
                                        entries.map(([type, count]) => (
                                          <div key={type} className="flex items-center justify-between text-sm">
                                            <span>{OBJ_LABELS[type as keyof typeof OBJ_LABELS]}</span>
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
                                    {detail
                                      .slice()
                                      .sort((a, b) => b.date.localeCompare(a.date))
                                      .slice(0, 5)
                                      .map((c) => (
                                        <div key={c.id} className="flex items-center justify-between text-sm">
                                          <span className="text-muted-foreground">{new Date(c.date + "T00:00:00").toLocaleDateString()}</span>
                                          <Badge variant={Number(c.cash_collected) > 0 ? "gold" : "muted"}>
                                            {c.lead_status ?? "—"}
                                          </Badge>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {["Rank", "Setter", "New Leads", "Pitched", "Booked", "Book Rate", "Shown", "Show Rate", "Cash Collected"].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setterRows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No setter data for this period</td></tr>
                ) : (
                  setterRows.map((row, index) => (
                    <motion.tr
                      key={row.name}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b border-white/10 transition-colors hover:bg-white/[0.04]"
                    >
                      <td className="px-4 py-4"><RankCell index={index} /></td>
                      <td className="px-4 py-4"><NameCell name={row.name} isFirst={index === 0} /></td>
                      <td className="px-4 py-4">{row.newLeads}</td>
                      <td className="px-4 py-4">{row.pitched}</td>
                      <td className="px-4 py-4 font-bold text-blue-300">{row.booked}</td>
                      <td className="px-4 py-4">{percent(row.bookRate)}</td>
                      <td className="px-4 py-4">{row.shown}</td>
                      <td className="px-4 py-4">{percent(row.showRate)}</td>
                      <td className="px-4 py-4 font-bold text-command-gold">{currency(row.cash)}</td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
