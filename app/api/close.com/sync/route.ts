import { subDays } from "date-fns";
import { NextResponse } from "next/server";
import { fetchRecentCloseContacts, fetchRecentCloseOpportunities, mapCloseStageToStatus } from "@/lib/close";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = createSupabaseAdminClient();
  const since = subDays(new Date(), 30).toISOString();
  const [opportunities, contacts] = await Promise.all([
    fetchRecentCloseOpportunities(since),
    fetchRecentCloseContacts(since)
  ]);

  const callRows = opportunities.data.map((opportunity) => ({
    close_opportunity_id: opportunity.id,
    contact_id: opportunity.contact_id ?? opportunity.lead_id ?? null,
    status: mapCloseStageToStatus(opportunity.status_label),
    outcome: opportunity.note ?? null,
    revenue_generated: Number(opportunity.value ?? 0) / 100,
    cash_collected: mapCloseStageToStatus(opportunity.status_label) === "closed" ? Number(opportunity.value ?? 0) / 100 : 0,
    call_date: opportunity.date_updated ?? opportunity.date_created ?? new Date().toISOString()
  }));

  const leadRows = contacts.data.map((contact) => ({
    contact_id: contact.id,
    close_contact_id: contact.id,
    status: "pending",
    flag_level: "none",
    call_date: contact.date_created ?? new Date().toISOString()
  }));

  const [callResult, leadResult] = await Promise.all([
    callRows.length ? supabase.from("calls").upsert(callRows, { onConflict: "close_opportunity_id" }) : Promise.resolve({ error: null }),
    leadRows.length ? supabase.from("leads").upsert(leadRows, { onConflict: "close_contact_id" }) : Promise.resolve({ error: null })
  ]);

  if (callResult.error || leadResult.error) {
    return NextResponse.json({ error: callResult.error?.message ?? leadResult.error?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    calls_upserted: callRows.length,
    leads_upserted: leadRows.length
  });
}

export async function GET() {
  return POST();
}
