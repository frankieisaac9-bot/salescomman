// Minimal GoHighLevel API client + row mappers for the dm_* tables.
// Used by the incremental DM sync route; the one-time archive export
// (scripts/export-ghl-dms.mjs) has its own standalone copy.

const GHL_BASE = "https://services.leadconnectorhq.com";

export function isGhlConfigured() {
  return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
}

export async function ghlGet(
  path: string,
  params: Record<string, string | number | undefined>,
  version: string
): Promise<Record<string, unknown>> {
  const url = new URL(GHL_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: version,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`GHL ${path}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`GHL ${path}: rate limited after retries`);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function ghlConversationRow(c: any) {
  const raw = { ...c };
  delete raw.profilePhoto;
  return {
    id: c.id as string,
    source: "ghl",
    location_id: c.locationId ?? null,
    contact_id: c.contactId ?? null,
    contact_name: c.contactName ?? c.fullName ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    assigned_to: c.assignedTo ?? null,
    last_message_date: toIso(c.lastMessageDate),
    last_message_direction: c.lastMessageDirection ?? null,
    last_message_type: c.lastMessageType ?? null,
    unread_count: c.unreadCount ?? null,
    tags: Array.isArray(c.tags) ? c.tags : null,
    raw,
    synced_at: new Date().toISOString(),
  };
}

export function ghlMessageRow(m: any, conversationId: string) {
  return {
    id: m.id as string,
    conversation_id: conversationId,
    source: "ghl",
    contact_id: m.contactId ?? null,
    direction: m.direction ?? null,
    body: m.body ?? null,
    message_type: m.messageType ?? null,
    content_type: m.contentType ?? null,
    status: m.status ?? null,
    user_id: m.userId ?? null,
    sent_source: m.source ?? null,
    alt_id: m.altId ?? null,
    attachments: m.attachments?.length ? m.attachments : null,
    meta: m.meta ?? null,
    date_added: toIso(m.dateAdded),
    synced_at: new Date().toISOString(),
  };
}
