import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const SHEET_ID = process.env.GOOGLE_SHEETS_SETTER_ID;

// SETTER_SHEET_TABS: comma-separated tab names, one per setter, e.g. "Leah,Ashley,Selina,Amy"
// Falls back to a single "Setter Stats" tab if not set.
function getSetterTabs(): string[] {
  const env = process.env.SETTER_SHEET_TABS;
  if (!env) return ["Setter Stats"];
  return env.split(",").map((t) => t.trim()).filter(Boolean);
}

function parseSetterDate(raw: string): string | null {
  // Format: M/D/YYYY or MM/DD/YYYY
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseNum(value: unknown): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

async function fetchTab(sheetId: string, tabName: string): Promise<Record<string, unknown>[]> {
  // Add timestamp to bust Google's server-side CSV cache
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch "${tabName}": ${res.status}`);
  return parseCsv(await res.text());
}

function parseCsv(csv: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const nx = csv[i + 1];
    if (ch === '"' && quoted && nx === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && nx === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [headers, ...data] = rows;
  if (!headers) return [];
  // Include both named keys AND positional __colN keys for reliable index-based fallback
  return data.map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h.trim().toLowerCase()] = r[idx] ?? "";
      obj[`__col${idx}`] = r[idx] ?? "";
    });
    return obj;
  });
}

function buildSetterPayloads(rows: Record<string, unknown>[]): object[] {
  return rows
    .map((row) => {
      const dateStr = parseSetterDate(String(row["date"] ?? ""));
      if (!dateStr) return null;
      const setterName = String(row["setter name"] ?? "").trim();
      if (!setterName) return null;

      const payload: Record<string, unknown> = {
        setter_name: setterName,
        date: dateStr,
        new_leads: parseNum(row["new leads"]),
        dq: parseNum(row["dq"]),
        follow_ups: parseNum(row["follow ups"]),
        calls_pitched: parseNum(row["calls pitched/links sent"]),
        booked_calls: parseNum(row["booked calls"]),
        calls_on_calendar: parseNum(row["__col7"]),
        calls_shown: parseNum(row["calls shown"] ?? row["__col8"]),
        no_shows: parseNum(row["no shows"]),
        cancelled: parseNum(row["cancelled"]),
        reschedules: parseNum(row["reschedules"]),
      };
      const rawCash = String(row["cash collected"] ?? "").trim();
      const rawRevenue = String(row["revenue"] ?? "").trim();
      if (rawCash) payload.cash_collected = parseNum(row["cash collected"]);
      if (rawRevenue) payload.revenue = parseNum(row["revenue"]);

      const numFields = ["new_leads","dq","follow_ups","calls_pitched","booked_calls",
        "calls_on_calendar","calls_shown","no_shows","cancelled","reschedules","cash_collected","revenue"];
      const hasData = numFields.reduce((sum, k) => sum + ((payload[k] as number) || 0), 0) > 0;
      if (!hasData) return null;

      return payload;
    })
    .filter(Boolean) as object[];
}

export async function POST(_request: Request) {
  if (!SHEET_ID) {
    return NextResponse.json({ error: "Missing GOOGLE_SHEETS_SETTER_ID" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const tabs = getSetterTabs();
    const allPayloads: Record<string, unknown>[] = [];
    const tabResults: Record<string, unknown> = {};
    let anyFetchError = false;

    for (const tab of tabs) {
      let rows: Record<string, unknown>[] = [];
      try {
        rows = await fetchTab(SHEET_ID, tab);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Setter sync] Failed to fetch tab "${tab}":`, msg);
        tabResults[tab] = { error: msg };
        anyFetchError = true;
        continue;
      }

      if (rows[0]) {
        const headers = Object.keys(rows[0]).filter(k => !k.startsWith("__col"));
        console.log(`[Setter sync] Tab "${tab}" headers:`, headers);
      }

      const payloads = buildSetterPayloads(rows) as Record<string, unknown>[];
      allPayloads.push(...payloads);
      tabResults[tab] = { raw_rows: rows.length, upserted: payloads.length };
    }

    if (!allPayloads.length) {
      return NextResponse.json({ ok: true, rows_upserted: 0, tabs: tabResults });
    }

    const { error } = await supabase
      .from("setter_stats")
      .upsert(allPayloads, { onConflict: "setter_name,date" });

    if (error) throw new Error(error.message);

    // Sheet is the source of truth: remove DB rows whose sheet rows were
    // deleted or cleared. Skipped if any tab failed to fetch, so a transient
    // Google error can't wipe a setter's history.
    let staleDeleted = 0;
    if (!anyFetchError) {
      const keys = new Set(allPayloads.map(p => `${p.setter_name}|${p.date}`));
      const { data: dbRows } = await supabase.from("setter_stats").select("id,setter_name,date");
      const staleIds = (dbRows ?? [])
        .filter(r => !keys.has(`${r.setter_name}|${r.date}`))
        .map(r => r.id);
      if (staleIds.length) {
        const { error: delError } = await supabase.from("setter_stats").delete().in("id", staleIds);
        if (!delError) staleDeleted = staleIds.length;
      }
    }

    return NextResponse.json({ ok: true, rows_upserted: allPayloads.length, stale_deleted: staleDeleted, tabs: tabResults });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Setter sheet sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

