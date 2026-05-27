import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyGoogleSheetsSyncSecret } from "@/lib/sheets";

const SHEET_ID = process.env.GOOGLE_SHEETS_TRACKING_ID;

const TABS = [
  "Dawid (dark blue)",
  "James (red)"
];

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

function parseTrackingDate(raw: string): string | null {
  const parts = raw.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 2) return null;
  const monthIndex = MONTH_MAP[parts[0]];
  if (monthIndex === undefined) return null;
  const day = Number(parts[1]);
  if (isNaN(day) || day < 1 || day > 31) return null;
  const now = new Date();
  // If month is after current month it must be from the previous year
  const year = monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value: unknown): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseCount(value: unknown): number {
  if (!value) return 0;
  const num = parseInt(String(value).trim(), 10);
  return isNaN(num) ? 0 : num;
}

async function fetchTab(sheetId: string, tabName: string): Promise<Record<string, unknown>[]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch tab "${tabName}": ${res.status}`);
  const csv = await res.text();
  return parseCsvToRows(csv);
}

function parseCsvToRows(csv: string): Record<string, unknown>[] {
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

  const [headers, ...dataRows] = rows;
  if (!headers) return [];
  return dataRows.map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => { obj[h.trim()] = r[idx] ?? ""; });
    return obj;
  });
}

export async function POST(request: Request) {
  if (!verifyGoogleSheetsSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid sync secret" }, { status: 401 });
  }
  if (!SHEET_ID) {
    return NextResponse.json({ error: "Missing GOOGLE_SHEETS_TRACKING_ID" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    // Load rep name → id map
    const { data: repsData } = await supabase.from("reps").select("id, name");
    const repMap = new Map<string, string>();
    for (const rep of repsData ?? []) {
      repMap.set(rep.name.toLowerCase().trim(), rep.id);
    }
    const findRepId = (firstName: string): string | null => {
      const q = firstName.toLowerCase().trim();
      for (const [key, id] of Array.from(repMap.entries())) {
        if (key.includes(q) || q.includes(key)) return id;
      }
      return null;
    };

    let totalUpserted = 0;

    for (const tab of TABS) {
      const repFirstName = tab.split(" ")[0];
      const repId = findRepId(repFirstName);
      const rows = await fetchTab(SHEET_ID, tab);

      const payloads = rows
        .map((row) => {
          const dateStr = parseTrackingDate(String(row["s"] ?? ""));
          if (!dateStr) return null;
          const booked = parseCount(row["Booked"]);
          if (booked === 0 && parseCount(row["Available"]) === 0) return null;
          return {
            rep_id: repId,
            rep_name: repFirstName,
            date: dateStr,
            available: parseCount(row["Available"]),
            booked,
            showed: parseCount(row["Showed"]),
            canceled: parseCount(row["Canceled"]),
            no_show: parseCount(row["No Show"]),
            offer: parseCount(row["Offer"]),
            deposit: parseCount(row["Deposit"]),
            closed: parseCount(row["Closed"]),
            cash_collected: parseAmount(row["Cash Collected"]),
            rev_generated: parseAmount(row["Rev Generated"])
          };
        })
        .filter(Boolean) as object[];

      if (payloads.length) {
        const { error } = await supabase
          .from("daily_stats")
          .upsert(payloads, { onConflict: "rep_id,date" });
        if (error) throw new Error(`${tab}: ${error.message}`);
        totalUpserted += payloads.length;
      }
    }

    return NextResponse.json({ ok: true, rows_upserted: totalUpserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Tracking sheet sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
