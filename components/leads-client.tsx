"use client";

import { useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import type { FlagLevel, Lead, LeadStatus, Rep } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";

const flagCopy: Record<FlagLevel, string> = {
  none: "Healthy",
  day3: "Needs first follow-up",
  day7: "Overdue follow-up",
  day10: "At risk of going cold",
  day14: "Gone cold — action required"
};

const flagVariant: Record<FlagLevel, "default" | "gold" | "muted" | "danger"> = {
  none: "muted",
  day3: "default",
  day7: "gold",
  day10: "gold",
  day14: "danger"
};

const statusOptions: LeadStatus[] = ["pending", "followed_up", "converted", "dead"];

export function LeadsClient({ initialLeads, reps }: { initialLeads: Lead[]; reps: Rep[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [filterFlag, setFilterFlag] = useState<FlagLevel | "all">("all");
  const [filterRep, setFilterRep] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "all">("all");
  const [updating, setUpdating] = useState<string | null>(null);

  const filtered = leads.filter((lead) => {
    if (filterFlag !== "all" && lead.flag_level !== filterFlag) return false;
    if (filterRep !== "all" && lead.rep_id !== filterRep) return false;
    if (filterStatus !== "all" && lead.status !== filterStatus) return false;
    return true;
  });

  async function updateStatus(leadId: string, newStatus: LeadStatus) {
    if (!isSupabaseBrowserConfigured()) { toast.error("Supabase not configured"); return; }
    setUpdating(leadId);
    const supabase = createSupabaseBrowserClient();
    const updates: Partial<Lead> = {
      status: newStatus,
      ...(newStatus === "followed_up" ? { last_follow_up: new Date().toISOString() } : {})
    };
    const { error } = await supabase.from("leads").update(updates).eq("id", leadId);
    if (error) {
      toast.error(error.message);
    } else {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId ? { ...lead, ...updates } : lead
        )
      );
      toast.success(`Lead marked as ${newStatus.replace("_", " ")}`);
    }
    setUpdating(null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={filterFlag}
          onChange={(e) => setFilterFlag(e.target.value as FlagLevel | "all")}
          className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Flags</option>
          {(["none", "day3", "day7", "day10", "day14"] as FlagLevel[]).map((f) => (
            <option key={f} value={f}>{flagCopy[f]}</option>
          ))}
        </select>
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Reps</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id}>{rep.name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeadStatus | "all")}
          className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
        <div className="ml-auto text-sm text-muted-foreground self-center">{filtered.length} leads</div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase text-muted-foreground">
              <tr>
                {["Rep", "Contact", "Call Date", "Days", "Flag", "Status", "Last Follow-Up", "Notes", "Actions"].map(
                  (heading) => (
                    <th key={heading} className="px-4 py-3 font-semibold">
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const days = lead.call_date
                  ? differenceInCalendarDays(new Date(), new Date(lead.call_date))
                  : 0;
                const repName = reps.find((r) => r.id === lead.rep_id)?.name ?? lead.reps?.name ?? "Unassigned";
                return (
                  <tr key={lead.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                    <td className="px-4 py-4">{repName}</td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {lead.close_contact_id ?? lead.contact_id ?? "None"}
                    </td>
                    <td className="px-4 py-4">
                      {lead.call_date ? new Date(lead.call_date).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-4">{days}</td>
                    <td className="px-4 py-4">
                      <Badge variant={flagVariant[lead.flag_level]}>
                        {flagCopy[lead.flag_level]}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 capitalize">{lead.status.replace("_", " ")}</td>
                    <td className="px-4 py-4">
                      {lead.last_follow_up
                        ? new Date(lead.last_follow_up).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-4 py-4 max-w-[160px] truncate text-muted-foreground">
                      {lead.notes ?? "-"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        {lead.status !== "followed_up" && lead.status !== "converted" && lead.status !== "dead" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updating === lead.id}
                            onClick={() => updateStatus(lead.id, "followed_up")}
                          >
                            Follow Up
                          </Button>
                        )}
                        {lead.status !== "converted" && lead.status !== "dead" && (
                          <Button
                            size="sm"
                            variant="default"
                            disabled={updating === lead.id}
                            onClick={() => updateStatus(lead.id, "converted")}
                          >
                            Converted
                          </Button>
                        )}
                        {lead.status !== "dead" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={updating === lead.id}
                            onClick={() => updateStatus(lead.id, "dead")}
                            className="text-red-400 hover:text-red-300"
                          >
                            Dead
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    No leads match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
