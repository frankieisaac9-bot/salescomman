// One-time export of all GoHighLevel conversations + messages into Supabase
// (dm_conversations / dm_messages / dm_users) before the ManyChat migration.
//
// Setup:
//   1. Run supabase/dm_archive.sql in the Supabase SQL editor.
//   2. In GHL: Settings → Private Integrations → create a token with scopes
//      "View Conversations", "View Conversation Messages", "View Users".
//   3. Add to .env.local:
//        GHL_API_KEY=pit-...
//        GHL_LOCATION_ID=iQObO82U4gGHIL9dqk46
//        GHL_EXPORT_SUPABASE_URL=...          # Slice Squad project (hchelbynapjzsukzjyqp)
//        GHL_EXPORT_SUPABASE_SERVICE_KEY=...  # its service_role key
//      The two GHL_EXPORT_SUPABASE_* vars are REQUIRED because the local
//      .env.local defaults point at the Superhuman Supabase project — GHL data
//      belongs to Slice Squad and must not be mixed in.
//   4. node scripts/export-ghl-dms.mjs
//
// Resumable: progress is checkpointed to scripts/.ghl-export-checkpoint.json
// after every page, so re-running continues where it left off. Rows are
// upserted, so overlap is harmless. Pass --fresh to restart from the beginning.
//
// Optional env:
//   GHL_EXPORT_LAST_MESSAGE_TYPE  e.g. TYPE_INSTAGRAM to only export
//     conversations whose *last* message is Instagram. Default: everything.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKPOINT_FILE = join(ROOT, "scripts", ".ghl-export-checkpoint.json");
const GHL_BASE = "https://services.leadconnectorhq.com";

// ---------- env ----------

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
// Deliberately NOT falling back to NEXT_PUBLIC_SUPABASE_URL: the local env
// defaults point at the Superhuman project, and GHL data is Slice Squad's.
const SUPABASE_URL = process.env.GHL_EXPORT_SUPABASE_URL;
const SERVICE_ROLE = process.env.GHL_EXPORT_SUPABASE_SERVICE_KEY;
const LAST_MESSAGE_TYPE = process.env.GHL_EXPORT_LAST_MESSAGE_TYPE || "";

for (const [name, val] of [
  ["GHL_API_KEY", GHL_API_KEY],
  ["GHL_LOCATION_ID", GHL_LOCATION_ID],
  ["GHL_EXPORT_SUPABASE_URL", SUPABASE_URL],
  ["GHL_EXPORT_SUPABASE_SERVICE_KEY", SERVICE_ROLE],
]) {
  if (!val) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- rate limiter (GHL burst limit: 100 requests / 10s) ----------

const MAX_RPS = 8;
let tokens = MAX_RPS;
setInterval(() => {
  tokens = Math.min(MAX_RPS, tokens + MAX_RPS);
}, 1000).unref();

async function rateLimited(fn) {
  while (tokens <= 0) await new Promise((r) => setTimeout(r, 50));
  tokens -= 1;
  return fn();
}

async function ghlGet(path, params, version) {
  const url = new URL(GHL_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await rateLimited(() =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${GHL_API_KEY}`,
            Version: version,
            Accept: "application/json",
          },
        })
      );
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} on ${path}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      if (String(err).includes("HTTP 4")) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// GHL caps page size differently per endpoint; fall back to 20 if 100 is rejected.
let searchPageSize = 100;
let messagesPageSize = 100;

async function searchConversations(startAfterDate) {
  const params = {
    locationId: GHL_LOCATION_ID,
    limit: searchPageSize,
    sortBy: "last_message_date",
    sort: "asc",
    lastMessageType: LAST_MESSAGE_TYPE || undefined,
    startAfterDate: startAfterDate || undefined,
  };
  try {
    return await ghlGet("/conversations/search", params, "2021-04-15");
  } catch (err) {
    if (searchPageSize > 20 && String(err).includes("HTTP 4")) {
      searchPageSize = 20;
      console.warn("Search page size 100 rejected, falling back to 20.");
      return ghlGet("/conversations/search", { ...params, limit: 20 }, "2021-04-15");
    }
    throw err;
  }
}

async function fetchAllMessages(conversationId) {
  const all = [];
  let lastMessageId;
  for (;;) {
    const params = { limit: messagesPageSize, lastMessageId: lastMessageId || undefined };
    let data;
    try {
      data = await ghlGet(`/conversations/${conversationId}/messages`, params, "2021-04-15");
    } catch (err) {
      if (messagesPageSize > 20 && String(err).includes("HTTP 4")) {
        messagesPageSize = 20;
        console.warn("Messages page size 100 rejected, falling back to 20.");
        continue;
      }
      throw err;
    }
    const box = data.messages ?? data;
    const page = Array.isArray(box) ? box : box.messages ?? [];
    all.push(...page);
    const nextPage = Array.isArray(box) ? false : Boolean(box.nextPage);
    lastMessageId = Array.isArray(box) ? undefined : box.lastMessageId;
    if (!nextPage || page.length === 0 || !lastMessageId) return all;
  }
}

// ---------- row mapping ----------

function toIso(value) {
  if (!value) return null;
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function conversationRow(c) {
  const raw = { ...c };
  delete raw.profilePhoto; // large signed CDN URLs, expire anyway
  return {
    id: c.id,
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

function messageRow(m, conversationId) {
  return {
    id: m.id,
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

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`Supabase upsert into ${table} failed: ${error.message}`);
  }
}

// ---------- users (setter names) ----------

async function exportUsers() {
  try {
    const data = await ghlGet("/users/", { locationId: GHL_LOCATION_ID }, "2021-07-28");
    const users = data.users ?? [];
    if (users.length) {
      await upsert(
        "dm_users",
        users.map((u) => ({
          id: u.id,
          name: u.name ?? [u.firstName, u.lastName].filter(Boolean).join(" ") ?? null,
          first_name: u.firstName ?? null,
          last_name: u.lastName ?? null,
          email: u.email ?? null,
          raw: u,
          synced_at: new Date().toISOString(),
        }))
      );
    }
    console.log(`Users: exported ${users.length}`);
  } catch (err) {
    console.warn(`Users export skipped (add "View Users" scope to fix): ${err.message}`);
  }
}

// ---------- checkpoint ----------

function loadCheckpoint() {
  if (process.argv.includes("--fresh") || !existsSync(CHECKPOINT_FILE)) {
    return { startAfterDate: 0, conversations: 0, messages: 0 };
  }
  return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
}

function saveCheckpoint(cp) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp));
}

// ---------- main ----------

async function run() {
  const started = Date.now();
  const cp = loadCheckpoint();
  if (cp.conversations > 0) {
    console.log(`Resuming from checkpoint: ${cp.conversations} conversations already done.`);
  }

  await exportUsers();

  let prevLastId = null;
  for (;;) {
    const data = await searchConversations(cp.startAfterDate);
    const convos = data.conversations ?? [];
    if (convos.length === 0) break;

    // Guard against a stalled cursor (identical page returned twice).
    const lastConv = convos[convos.length - 1];
    if (lastConv.id === prevLastId) {
      console.warn("Cursor stalled; nudging startAfterDate forward 1ms.");
      cp.startAfterDate += 1;
      saveCheckpoint(cp);
      continue;
    }
    prevLastId = lastConv.id;

    await upsert("dm_conversations", convos.map(conversationRow));

    // Fetch message history with limited parallelism (rate limiter caps RPS).
    const CONCURRENCY = 6;
    for (let i = 0; i < convos.length; i += CONCURRENCY) {
      const batch = convos.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (c) => {
          try {
            return (await fetchAllMessages(c.id)).map((m) => messageRow(m, c.id));
          } catch (err) {
            console.warn(`  messages failed for conversation ${c.id}: ${err.message}`);
            return [];
          }
        })
      );
      const rows = results.flat();
      if (rows.length) await upsert("dm_messages", rows);
      cp.messages += rows.length;
    }

    cp.conversations += convos.length;
    cp.startAfterDate = Array.isArray(lastConv.sort)
      ? lastConv.sort[lastConv.sort.length - 1]
      : lastConv.lastMessageDate;
    saveCheckpoint(cp);

    const mins = ((Date.now() - started) / 60000).toFixed(1);
    const pos = toIso(cp.startAfterDate) ?? cp.startAfterDate;
    const total = data.total ?? "?";
    console.log(
      `Conversations: ${cp.conversations}/${total} · messages: ${cp.messages} · at ${pos} · ${mins}m elapsed`
    );
  }

  console.log(
    `\nDone. ${cp.conversations} conversations and ${cp.messages} messages archived to Supabase.`
  );
  process.exit(0);
}

run().catch((err) => {
  console.error(`\nExport stopped: ${err.message}`);
  console.error("Progress is checkpointed — re-run the script to resume.");
  process.exit(1);
});
