import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// Instagram DM webhook receiver (Slice Squad). Captures every inbound lead
// message and every outbound reply (message_echoes fires even for messages
// setters type inside ManyChat) into dm_conversations / dm_messages with
// source = 'instagram'. Gated behind env vars so it 404s on deployments that
// don't set them:
//   INSTAGRAM_VERIFY_TOKEN  — any string you choose; must match the Meta app
//   INSTAGRAM_APP_SECRET    — Meta app secret, used to verify payload signatures

export const dynamic = "force-dynamic";

function isConfigured() {
  return Boolean(process.env.INSTAGRAM_VERIFY_TOKEN && process.env.INSTAGRAM_APP_SECRET);
}

// Meta verification handshake: echoes hub.challenge when the verify token matches.
export async function GET(request: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  const params = new URL(request.url).searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === process.env.INSTAGRAM_VERIFY_TOKEN
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function validSignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string)
    .update(rawBody)
    .digest("hex");
  const received = header.slice("sha256=".length);
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"))
  );
}

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
    is_deleted?: boolean;
    is_unsupported?: boolean;
  };
};

export async function POST(request: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { object?: string; entry?: { messaging?: MessagingEvent[] }[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (payload.object !== "instagram") return NextResponse.json({ ok: true, skipped: true });

  const supabase = createSupabaseAdminClient();
  let stored = 0;

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const msg = event.message;
      if (!msg?.mid || msg.is_deleted) continue;

      const isEcho = Boolean(msg.is_echo);
      // The lead's Instagram-scoped id: sender on inbound, recipient on echoes.
      const leadId = isEcho ? event.recipient?.id : event.sender?.id;
      if (!leadId) continue;

      const conversationId = `ig:${leadId}`;
      const sentAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

      const { error: convError } = await supabase.from("dm_conversations").upsert(
        {
          id: conversationId,
          source: "instagram",
          contact_id: leadId,
          last_message_date: sentAt,
          last_message_direction: isEcho ? "outbound" : "inbound",
          last_message_type: "TYPE_INSTAGRAM",
          synced_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (convError) {
        console.error("instagram webhook: conversation upsert failed", convError.message);
        continue;
      }

      const { error: msgError } = await supabase.from("dm_messages").upsert(
        {
          id: msg.mid,
          conversation_id: conversationId,
          source: "instagram",
          contact_id: leadId,
          direction: isEcho ? "outbound" : "inbound",
          body: msg.text ?? null,
          message_type: "TYPE_INSTAGRAM",
          status: msg.is_unsupported ? "unsupported" : "delivered",
          alt_id: msg.mid,
          attachments: msg.attachments?.length ? msg.attachments : null,
          meta: { sender: event.sender?.id, recipient: event.recipient?.id },
          date_added: sentAt,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (msgError) {
        console.error("instagram webhook: message upsert failed", msgError.message);
        continue;
      }
      stored += 1;
    }
  }

  // Always 200 so Meta doesn't disable the subscription on transient errors.
  return NextResponse.json({ ok: true, stored });
}
