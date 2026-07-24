import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// Matches recent dm_conversations to their ManyChat subscriber so alerts can
// (a) deep-link straight into the ManyChat inbox chat and (b) pick up the
// "Assigned (m)" custom field once assignments are stamped in ManyChat.
// Runs on the 15-minute cron via /api/sync-all. Env-gated on MANYCHAT_API_KEY.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MC_BASE = "https://api.manychat.com";
const LOOKBACK_HOURS = Number(process.env.DM_SYNC_LOOKBACK_HOURS ?? 48);
// Small enough to finish inside Vercel's 60s budget; the 15-min cron catches up.
const MAX_LOOKUPS_PER_RUN = 25;
const ASSIGNED_FIELD_NAME = "Assigned (m)";
const NOT_FOUND = "not_found";

type McSubscriber = any;

async function mcGet(path: string, params: Record<string, string>) {
  const url = new URL(MC_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}` },
    cache: "no-store",
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    return mcGet(path, params);
  }
  if (!res.ok) throw new Error(`ManyChat ${path}: HTTP ${res.status}`);
  return res.json();
}

// Prefer the candidate that is an active Instagram contact; among those, the
// one seen most recently (duplicate subscriber records per person are common —
// e.g. one FB record and one IG record).
function pickSubscriber(candidates: McSubscriber[], contactName: string): McSubscriber | null {
  const nameLc = contactName.trim().toLowerCase();
  const named = candidates.filter((s) => (s.name ?? "").trim().toLowerCase() === nameLc);
  const pool = named.length ? named : candidates;
  if (!pool.length) return null;
  const ig = pool.filter((s) => s.ig_id || s.ig_last_interaction);
  const best = (ig.length ? ig : pool).sort(
    (a, b) =>
      new Date(b.ig_last_interaction ?? b.last_interaction ?? 0).getTime() -
      new Date(a.ig_last_interaction ?? a.last_interaction ?? 0).getTime()
  );
  return best[0];
}

// Assignment source, in priority order: the "Assigned (m)" custom field, or a
// "setter-<name>" tag (setters tap their tag when they claim a chat).
function assignedValue(sub: McSubscriber): string | null {
  const field = (sub.custom_fields ?? []).find(
    (f: { name?: string }) => f.name === ASSIGNED_FIELD_NAME
  );
  if (typeof field?.value === "string" && field.value.trim()) return field.value.trim();
  for (const tag of sub.tags ?? []) {
    const m = /^setter[-_ ]+(.+)$/i.exec(tag?.name ?? "");
    if (m) return m[1].trim();
  }
  return null;
}

export async function POST() {
  if (!process.env.MANYCHAT_API_KEY) {
    return NextResponse.json({ skipped: "ManyChat not configured" });
  }

  const supabase = createSupabaseAdminClient();
  const lookbackIso = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

  // Pass 1: recent conversations not yet matched to a ManyChat subscriber.
  const { data: unmatched, error: unmatchedError } = await supabase
    .from("dm_conversations")
    .select("id, contact_name")
    .gte("last_message_date", lookbackIso)
    .is("mc_subscriber_id", null)
    .not("contact_name", "is", null)
    .order("last_message_date", { ascending: false })
    .limit(MAX_LOOKUPS_PER_RUN);
  if (unmatchedError) {
    return NextResponse.json({ error: unmatchedError.message }, { status: 500 });
  }

  let matched = 0;
  let notFound = 0;
  for (const conv of unmatched ?? []) {
    try {
      const res = await mcGet("/fb/subscriber/findByName", { name: conv.contact_name });
      const sub = pickSubscriber(res.data ?? [], conv.contact_name);
      await supabase
        .from("dm_conversations")
        .update(
          sub
            ? {
                mc_subscriber_id: String(sub.id),
                mc_chat_url: sub.live_chat_url ?? null,
                mc_assigned: assignedValue(sub),
              }
            : { mc_subscriber_id: NOT_FOUND }
        )
        .eq("id", conv.id);
      sub ? matched++ : notFound++;
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn(`manychat enrich: lookup failed for "${conv.contact_name}":`, err);
    }
  }

  // Pass 2: refresh assignment for matched conversations that currently need
  // attention (lead waiting) and have no assignment recorded yet.
  const { data: needsAssignee } = await supabase
    .from("dm_conversations")
    .select("id, mc_subscriber_id")
    .gte("last_message_date", lookbackIso)
    .eq("last_message_direction", "inbound")
    .is("assigned_to", null)
    .is("mc_assigned", null)
    .not("mc_subscriber_id", "is", null)
    .neq("mc_subscriber_id", NOT_FOUND)
    .limit(15);

  let refreshed = 0;
  for (const conv of needsAssignee ?? []) {
    try {
      const res = await mcGet("/fb/subscriber/getInfo", { subscriber_id: conv.mc_subscriber_id });
      const value = res.data ? assignedValue(res.data) : null;
      if (value) {
        await supabase.from("dm_conversations").update({ mc_assigned: value }).eq("id", conv.id);
        refreshed++;
      }
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn(`manychat enrich: getInfo failed for ${conv.mc_subscriber_id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, matched, notFound, assignmentsFound: refreshed });
}

export async function GET() {
  return POST();
}
