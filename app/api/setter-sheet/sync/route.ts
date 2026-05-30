import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const SHEET_ID = process.env.GOOGLE_SHEETS_SETTER_ID;
const TAB = "Setter Stats";

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
  return data.map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => { obj[h.trim().toLowerCase()] = r[idx] ?? ""; });
    return obj;
  });
}

export async function POST(_request: Request) {
  if (!SHEET_ID) {
    return NextResponse.json({ error: "Missing GOOGLE_SHEETS_SETTER_ID" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const rows = await fetchTab(SHEET_ID, TAB);

    const payloads = rows
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
          calls_on_calendar: parseNum(row["calls on the calendar"] ?? row["calls on calendar"] ?? row["calls on the calendar that day"] ?? ""),
          calls_shown: parseNum(row["calls shown"]),
          no_shows: parseNum(row["no shows"]),
          cancelled: parseNum(row["cancelled"]),
          reschedules: parseNum(row["reschedules"]),
        };
        // Only set cash fields if the sheet cell is non-empty — prevents overwriting
        // real values with 0 when Google serves a cached/stale CSV
        const rawCash = String(row["cash collected"] ?? "").trim();
        const rawRevenue = String(row["revenue"] ?? "").trim();
        if (rawCash) payload.cash_collected = parseNum(row["cash collected"]);
        if (rawRevenue) payload.revenue = parseNum(row["revenue"]);

        // Skip completely empty rows (placeholder future-date rows in the sheet)
        const numFields = ["new_leads","dq","follow_ups","calls_pitched","booked_calls",
          "calls_on_calendar","calls_shown","no_shows","cancelled","reschedules","cash_collected","revenue"];
        const hasData = numFields.reduce((sum, k) => sum + ((payload[k] as number) || 0), 0) > 0;
        if (!hasData) return null;

        return payload;
      })
      .filter(Boolean) as object[];

    if (!payloads.length) {
      return NextResponse.json({ ok: true, rows_upserted: 0 });
    }

    const { error } = await supabase
      .from("setter_stats")
      .upsert(payloads, { onConflict: "setter_name,date" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, rows_upserted: payloads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Setter sheet sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

