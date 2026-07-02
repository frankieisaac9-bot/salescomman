import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const SHEET_ID = process.env.GOOGLE_SHEETS_TRACKING_ID;

const DEFAULT_TABS: { name: string; repFirstName: string; gid?: string }[] = [
  { name: "Dawid (dark blue)", repFirstName: "Dawid" },
  { name: "James (red)",       repFirstName: "James" },
  { name: "Downsells",         repFirstName: "Downsells", gid: "27092439" },
];

// TRACKING_SHEET_TABS env var format: "Tab Name:RepFirstName,Tab Name:RepFirstName"
// e.g. "Katrina (dark blue):Katrina,Carli (red):Carli"
// Falls back to DEFAULT_TABS if not set.
function getTrackingTabs(): { name: string; repFirstName: string; gid?: string }[] {
  const env = process.env.TRACKING_SHEET_TABS;
  if (!env) return DEFAULT_TABS;
  return env.split(",").map((entry) => {
    const colonIdx = entry.lastIndexOf(":");
    if (colonIdx === -1) return { name: entry.trim(), repFirstName: entry.trim() };
    return { name: entry.slice(0, colonIdx).trim(), repFirstName: entry.slice(colonIdx + 1).trim() };
  });
}

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

async function fetchTab(sheetId: string, tabName: string, gid?: string): Promise<Record<string, unknown>[]> {
  const param = gid ? `gid=${gid}` : `sheet=${encodeURIComponent(tabName)}`;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${param}`;
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
    const obj: Record<string, unknown> = { __col0: r[0] ?? "" };
    headers.forEach((h, idx) => { obj[h.trim()] = r[idx] ?? ""; });
    return obj;
  });
}

export async function POST(_request: Request) {
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
    const tabResults: Record<string, unknown> = {};

    for (const tab of getTrackingTabs()) {
      const { name: tabName, repFirstName, gid } = tab;
      const repId = findRepId(repFirstName);

      let rows: Record<string, unknown>[] = [];
      try {
        rows = await fetchTab(SHEET_ID, tabName, gid);
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[Tracking sync] Failed to fetch tab "${tabName}":`, msg);
        tabResults[tabName] = { error: msg, raw_rows: 0, upserted: 0 };
        continue;
      }

      // Log first row keys so we can debug column names
      const firstRowKeys = rows[0] ? Object.keys(rows[0]) : [];
      console.log(`[Tracking sync] Tab "${tabName}" — ${rows.length} raw rows, cols:`, firstRowKeys.slice(0, 6));

      const payloads = rows
        .map((row) => {
          const dateStr = parseTrackingDate(String(row["__col0"] ?? row["s"] ?? row[""] ?? ""));
          if (!dateStr) return null;
          const booked = parseCount(row["Booked"]);
          const hasCash = parseAmount(row["Cash Collected"]) > 0 || parseAmount(row["Rev Generated"]) > 0;
          if (booked === 0 && parseCount(row["Available"]) === 0 && !hasCash) return null;
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
          .upsert(payloads, { onConflict: "rep_name,date" });
        if (error) {
          console.error(`[Tracking sync] Upsert error for tab "${tabName}":`, error.message);
          tabResults[tabName] = { error: error.message, raw_rows: rows.length, upserted: 0 };
          continue;
        }
        totalUpserted += payloads.length;
        tabResults[tabName] = { raw_rows: rows.length, upserted: payloads.length };
      } else {
        tabResults[tabName] = { raw_rows: rows.length, upserted: 0, note: "no valid rows after filter" };
      }
    }

    return NextResponse.json({ ok: true, rows_upserted: totalUpserted, tabs: tabResults });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Tracking sheet sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
