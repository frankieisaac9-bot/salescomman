import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const SHEET_ID = process.env.GOOGLE_SHEETS_POST_CALL_ID;
const TAB = "postcallformresponses";

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null;
  // Handle M/D/YYYY
  const slash = raw.trim().split("/");
  if (slash.length === 3) {
    const [m, d, y] = slash;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    const year = parseInt(y, 10);
    if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNum(v: unknown): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function parseBool(v: unknown): boolean {
  return String(v ?? "").toLowerCase().trim() === "yes";
}

async function fetchSheet(): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  return parseCsv(await res.text());
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i], nx = csv[i + 1];
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
  return rows;
}

export async function POST(_request: Request) {
  if (!SHEET_ID) return NextResponse.json({ error: "Missing GOOGLE_SHEETS_POST_CALL_ID" }, { status: 500 });

  try {
    const rows = await fetchSheet();
    if (rows.length < 2) return NextResponse.json({ ok: true, rows_upserted: 0 });

    // Col indices: 0=timestamp, 1=date, 2=rep, 3=email, 4=setter,
    // 5=problem, 6=goal, 7=obstacles, 8=job, 9=notes,
    // 10=offer_made, 11=lead_status, 12=recording, 13=cash, 14=revenue
    const dataRows = rows.slice(1);

    const payloads = dataRows
      .map((row) => {
        const timestamp = (row[0] ?? "").trim();
        if (!timestamp) return null;
        const repName = (row[2] ?? "").trim();
        if (!repName) return null;
        const dateStr = parseDate(row[1] ?? "") ?? parseDate(row[0] ?? "");
        if (!dateStr) return null;

        return {
          form_timestamp: timestamp,
          rep_name: repName,
          date: dateStr,
          lead_email: (row[3] ?? "").trim() || null,
          setter: (row[4] ?? "").trim() || null,
          problem: (row[5] ?? "").trim() || null,
          goal: (row[6] ?? "").trim() || null,
          obstacles: (row[7] ?? "").trim() || null,
          prospect_job: (row[8] ?? "").trim() || null,
          notes: (row[9] ?? "").trim() || null,
          offer_made: parseBool(row[10]),
          lead_status: (row[11] ?? "").trim() || null,
          call_recording_url: (row[12] ?? "").trim() || null,
          cash_collected: parseNum(row[13]),
          revenue: parseNum(row[14]),
        };
      })
      .filter(Boolean) as object[];

    if (!payloads.length) return NextResponse.json({ ok: true, rows_upserted: 0 });

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("closer_calls")
      .upsert(payloads, { onConflict: "form_timestamp" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, rows_upserted: payloads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Closer calls sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
