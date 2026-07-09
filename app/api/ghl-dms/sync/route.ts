import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ghlConversationRow, ghlGet, ghlMessageRow, isGhlConfigured } from "@/lib/ghl";

// Incremental DM sync: pulls recently-active GHL conversations (and their
// latest messages) into dm_conversations / dm_messages every cron tick, so the
// alert engine sees fresh data until the Instagram webhook takes over.
// Env-gated: no GHL_API_KEY → no-op (Superhuman deployment).

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_PAGES = Number(process.env.DM_SYNC_MAX_PAGES ?? 3);
const LOOKBACK_HOURS = Number(process.env.DM_SYNC_LOOKBACK_HOURS ?? 48);
const MESSAGES_PER_CONVERSATION = 50;
const CONCURRENCY = 10;

export async function POST() {
  if (!isGhlConfigured()) {
    return NextResponse.json({ skipped: "GHL not configured" });
  }

  const supabase = createSupabaseAdminClient();
  const cutoff = Date.now() - LOOKBACK_HOURS * 3_600_000;
  let conversations = 0;
  let messages = 0;
  let startAfterDate: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await ghlGet(
      "/conversations/search",
      {
        locationId: process.env.GHL_LOCATION_ID,
        limit: 100,
        sortBy: "last_message_date",
        sort: "desc",
        startAfterDate,
      },
      "2021-04-15"
    );
    const all = (data.conversations as any[]) ?? [];
    const recent = all.filter((c) => Number(c.lastMessageDate ?? 0) >= cutoff);
    if (recent.length === 0) break;

    const { error: convError } = await supabase
      .from("dm_conversations")
      .upsert(recent.map(ghlConversationRow), { onConflict: "id" });
    if (convError) {
      return NextResponse.json({ error: `conversation upsert: ${convError.message}` }, { status: 500 });
    }
    conversations += recent.length;

    for (let i = 0; i < recent.length; i += CONCURRENCY) {
      const batch = recent.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (c) => {
          try {
            const res = await ghlGet(
              `/conversations/${c.id}/messages`,
              { limit: MESSAGES_PER_CONVERSATION },
              "2021-04-15"
            );
            const box = (res.messages ?? res) as any;
            const page = Array.isArray(box) ? box : box.messages ?? [];
            return page.map((m: any) => ghlMessageRow(m, c.id));
          } catch (err) {
            console.warn(`ghl-dms sync: messages failed for ${c.id}:`, err);
            return [];
          }
        })
      );
      const rows = results.flat();
      if (rows.length) {
        const { error: msgError } = await supabase
          .from("dm_messages")
          .upsert(rows, { onConflict: "id" });
        if (msgError) {
          return NextResponse.json({ error: `message upsert: ${msgError.message}` }, { status: 500 });
        }
        messages += rows.length;
      }
    }

    // Stop paging once this page reached past the lookback window.
    if (recent.length < all.length || all.length === 0) break;
    const last = all[all.length - 1];
    startAfterDate = Array.isArray(last.sort) ? last.sort[last.sort.length - 1] : last.lastMessageDate;
  }

  return NextResponse.json({ ok: true, conversations, messages });
}

export async function GET() {
  return POST();
}
