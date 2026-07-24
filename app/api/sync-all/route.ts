import { NextResponse } from "next/server";

export const maxDuration = 60;

// Runs every sync in sequence — hit by the scheduled GitHub Action (and usable
// manually). Each sync route handles its own env config, so this works
// unchanged on every deployment.
const SYNC_PATHS = [
  "/api/tracking-sheet/sync",
  "/api/setter-sheet/sync",
  "/api/closer-calls/sync",
  "/api/ghl-dms/sync",
  "/api/manychat/enrich",
  "/api/dm-alerts/check",
];

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const results: Record<string, unknown> = {};

  for (const path of SYNC_PATHS) {
    try {
      const res = await fetch(`${origin}${path}`, { method: "POST", cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      results[path] = res.ok ? body : { error: body.error ?? `HTTP ${res.status}` };
    } catch (err) {
      results[path] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json({ ok: true, synced_at: new Date().toISOString(), results });
}

export async function POST(request: Request) {
  return GET(request);
}
