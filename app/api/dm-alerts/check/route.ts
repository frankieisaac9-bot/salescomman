import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// DM response-time alerts, run on the 15-minute cron via /api/sync-all.
//
//   Level 1 "setter_60m": lead unanswered for 60+ min → ping assigned setter + owner.
//   Level 2 "team_3h":    lead unanswered for 3+ hours → ping the whole channel
//                         (past this threshold the lead is anyone's to take).
//
// Alerts only send between 9am and 8pm America/New_York. Each breach episode
// (keyed by the first unanswered inbound message) notifies once per level,
// deduped via the dm_alerts table.
//
// Env (Slice Squad only — route no-ops without SLACK_WEBHOOK_URL):
//   SLACK_WEBHOOK_URL   Slack incoming-webhook URL for the private channel
//   SLACK_OWNER_ID      Frankie's Slack member id (U…) — cc'd on setter pings
//   Setter pings use dm_users.slack_user_id (set per setter in Supabase).
//
// Debug: ?dry=1 computes breaches without notifying or recording;
//        ?force=1 skips the working-hours gate (testing only).

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SETTER_MINUTES = Number(process.env.DM_ALERT_SETTER_MINUTES ?? 60);
const TEAM_MINUTES = Number(process.env.DM_ALERT_TEAM_MINUTES ?? 180);
const LOOKBACK_HOURS = Number(process.env.DM_ALERT_LOOKBACK_HOURS ?? 48);
const WORK_START_HOUR = Number(process.env.DM_ALERT_START_HOUR ?? 9); // ET
const WORK_END_HOUR = Number(process.env.DM_ALERT_END_HOUR ?? 20); // ET

function easternHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
}

function formatWait(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type Breach = {
  conversation_id: string;
  level: "setter_60m" | "team_3h";
  first_unanswered_at: string;
  assigned_to: string | null;
  waiting_minutes: number;
  contact_name: string;
  snippet: string;
};

export async function POST(request: Request) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    return NextResponse.json({ skipped: "Slack not configured" });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry") === "1";
  const force = params.get("force") === "1";

  const hour = easternHour();
  if (!force && (hour < WORK_START_HOUR || hour >= WORK_END_HOUR)) {
    return NextResponse.json({ skipped: `outside working hours (${hour}:00 ET)` });
  }

  const supabase = createSupabaseAdminClient();
  const now = Date.now();
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString();

  // Candidates: conversations whose most recent message came from the lead.
  const { data: candidates, error: candError } = await supabase
    .from("dm_conversations")
    .select("id, contact_name, assigned_to, location_id, last_message_date")
    .eq("last_message_direction", "inbound")
    .gte("last_message_date", lookbackIso)
    .order("last_message_date", { ascending: true })
    .limit(300);
  if (candError) {
    return NextResponse.json({ error: candError.message }, { status: 500 });
  }

  const breaches: Breach[] = [];
  for (const conv of candidates ?? []) {
    const { data: msgs, error: msgError } = await supabase
      .from("dm_messages")
      .select("direction, date_added, body")
      .eq("conversation_id", conv.id)
      .order("date_added", { ascending: false })
      .limit(100);
    if (msgError || !msgs?.length) continue;

    // Oldest inbound message since the team's last reply = start of the wait.
    let firstUnanswered: { date_added: string; body: string | null } | null = null;
    for (const m of msgs) {
      if (m.direction === "outbound") break;
      if (m.direction === "inbound" && m.date_added) firstUnanswered = m;
    }
    if (!firstUnanswered) continue;

    const waitingMinutes = (now - new Date(firstUnanswered.date_added).getTime()) / 60_000;
    if (waitingMinutes < SETTER_MINUTES) continue;

    const level = waitingMinutes >= TEAM_MINUTES ? "team_3h" : "setter_60m";
    breaches.push({
      conversation_id: conv.id,
      level,
      first_unanswered_at: firstUnanswered.date_added,
      assigned_to: conv.assigned_to ?? null,
      waiting_minutes: Math.round(waitingMinutes),
      contact_name: conv.contact_name ?? "Unknown lead",
      snippet: (firstUnanswered.body ?? "").slice(0, 80),
    });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, breaches });
  }
  if (breaches.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0 });
  }

  // Record each breach episode once per level; only newly-inserted rows notify.
  const { data: inserted, error: insertError } = await supabase
    .from("dm_alerts")
    .upsert(
      breaches.map((b) => ({
        conversation_id: b.conversation_id,
        level: b.level,
        first_unanswered_at: b.first_unanswered_at,
        assigned_to: b.assigned_to,
        waiting_minutes: b.waiting_minutes,
      })),
      { onConflict: "conversation_id,level,first_unanswered_at", ignoreDuplicates: true }
    )
    .select("conversation_id, level");
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const newKeys = new Set((inserted ?? []).map((r) => `${r.conversation_id}:${r.level}`));
  const fresh = breaches.filter((b) => newKeys.has(`${b.conversation_id}:${b.level}`));
  if (fresh.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0, alreadyNotified: breaches.length });
  }

  // Setter names + Slack ids for mentions.
  const setterIds = Array.from(
    new Set(fresh.map((b) => b.assigned_to).filter((id): id is string => Boolean(id)))
  );
  const { data: users } = setterIds.length
    ? await supabase.from("dm_users").select("id, name, slack_user_id").in("id", setterIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const ownerPing = process.env.SLACK_OWNER_ID ? ` <@${process.env.SLACK_OWNER_ID}>` : "";

  function describe(b: Breach): string {
    const user = b.assigned_to ? userById.get(b.assigned_to) : undefined;
    const setter = user?.slack_user_id
      ? `<@${user.slack_user_id}>`
      : user?.name ?? "unassigned";
    const link = b.conversation_id.startsWith("ig:")
      ? ""
      : ` — <https://app.slicetech.ai/v2/location/${process.env.GHL_LOCATION_ID}/conversations/conversations/${b.conversation_id}|open>`;
    return `• *${b.contact_name}* waiting *${formatWait(b.waiting_minutes)}* (${setter})${
      b.snippet ? ` — “${b.snippet}”` : ""
    }${link}`;
  }

  const lines: string[] = [];
  const teamBreaches = fresh.filter((b) => b.level === "team_3h");
  const setterBreaches = fresh.filter((b) => b.level === "setter_60m");
  if (teamBreaches.length) {
    lines.push(
      `🚨 <!channel> *${teamBreaches.length} lead${teamBreaches.length > 1 ? "s" : ""} unanswered for 3+ hours — up for grabs:*`,
      ...teamBreaches.map(describe)
    );
  }
  if (setterBreaches.length) {
    if (lines.length) lines.push("");
    lines.push(
      `⏰ *Waiting over ${SETTER_MINUTES} min:*${ownerPing}`,
      ...setterBreaches.map(describe)
    );
  }

  const slackRes = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
  if (!slackRes.ok) {
    return NextResponse.json({ error: `Slack post failed: HTTP ${slackRes.status}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, alerted: fresh.length });
}

export async function GET(request: Request) {
  return POST(request);
}
