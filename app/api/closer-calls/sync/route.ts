import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const SHEET_ID = process.env.GOOGLE_SHEETS_POST_CALL_ID;
// Tab selection: GID takes priority (works regardless of tab name), then tab name env,
// then the original Superhuman tab name.
const TAB_GID = process.env.GOOGLE_SHEETS_POST_CALL_GID;
const TAB_NAME = process.env.GOOGLE_SHEETS_POST_CALL_TAB || "postcallformresponses";

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
  const param = TAB_GID ? `gid=${TAB_GID}` : `sheet=${encodeURIComponent(TAB_NAME)}`;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&${param}&t=${Date.now()}`;
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

// Resolve column indices from header text so the same code works across clients
// whose form questions differ in wording and order.
function resolveColumns(headers: string[]) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const find = (pred: (v: string) => boolean) => h.findIndex(pred);
  return {
    timestamp: find((v) => v.startsWith("timestamp")),
    date: find((v) => v === "date"),
    rep: find((v) => v.includes("rep name") || v.includes("sales rep")),
    email: find((v) => v.includes("email")),
    setter: find((v) => v.includes("setter")),
    problem: find((v) => v.startsWith("problem")),
    goal: find((v) => v.startsWith("goal")),
    obstacles: find((v) => v.startsWith("obstacle")),
    job: find((v) => v.includes("job") || v.includes("occupation")),
    notes: find((v) => v.includes("notes")),
    offer: find((v) => v.includes("offer")),
    status: find((v) => v.includes("status")),
    recording: find((v) => v.includes("recording")),
    cash: find((v) => v.includes("cash")),
    revenue: find((v) => v.includes("revenue")),
  };
}

export async function POST(_request: Request) {
  if (!SHEET_ID) return NextResponse.json({ error: "Missing GOOGLE_SHEETS_POST_CALL_ID" }, { status: 500 });

  try {
    const rows = await fetchSheet();
    if (rows.length < 2) return NextResponse.json({ ok: true, rows_upserted: 0 });

    const col = resolveColumns(rows[0]);
    if (col.timestamp === -1 || col.rep === -1) {
      throw new Error(`Could not resolve required columns from headers: ${JSON.stringify(rows[0].slice(0, 6))}`);
    }
    const get = (row: string[], idx: number) => (idx === -1 ? "" : (row[idx] ?? "")).trim();

    const payloads = rows.slice(1)
      .map((row) => {
        const timestamp = get(row, col.timestamp);
        if (!timestamp) return null;
        const repName = get(row, col.rep);
        if (!repName) return null;
        const dateStr = parseDate(get(row, col.date)) ?? parseDate(timestamp);
        if (!dateStr) return null;

        return {
          form_timestamp: timestamp,
          rep_name: repName,
          date: dateStr,
          lead_email: get(row, col.email) || null,
          setter: get(row, col.setter) || null,
          problem: get(row, col.problem) || null,
          goal: get(row, col.goal) || null,
          obstacles: get(row, col.obstacles) || null,
          prospect_job: get(row, col.job) || null,
          notes: get(row, col.notes) || null,
          offer_made: parseBool(get(row, col.offer)),
          lead_status: get(row, col.status) || null,
          call_recording_url: get(row, col.recording) || null,
          cash_collected: parseNum(get(row, col.cash)),
          revenue: parseNum(get(row, col.revenue)),
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
