import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyGoogleSheetsSyncSecret } from "@/lib/sheets";

function parseSetterDate(raw: string): string | null {
  const parts = String(raw).trim().split("/");
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

export async function POST(request: Request) {
  if (!verifyGoogleSheetsSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid sync secret" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const rows: unknown[][] = body.data;

    if (!Array.isArray(rows) || rows.length < 2) {
      return NextResponse.json({ ok: true, rows_upserted: 0 });
    }

    // First row is headers — normalize them
    const headers = (rows[0] as string[]).map((h) => String(h).trim().toLowerCase());
    const dataRows = rows.slice(1);

    const idx = (name: string) => headers.indexOf(name);

    const payloads = dataRows
      .map((row) => {
        const dateStr = parseSetterDate(String(row[idx("date")] ?? ""));
        if (!dateStr) return null;
        const setterName = String(row[idx("setter name")] ?? "").trim();
        if (!setterName) return null;

        const payload = {
          setter_name: setterName,
          date: dateStr,
          new_leads: parseNum(row[idx("new leads")]),
          dq: parseNum(row[idx("dq")]),
          follow_ups: parseNum(row[idx("follow ups")]),
          calls_pitched: parseNum(row[idx("calls pitched/links sent")]),
          booked_calls: parseNum(row[idx("booked calls")]),
          calls_shown: parseNum(row[idx("calls shown")]),
          no_shows: parseNum(row[idx("no shows")]),
          cancelled: parseNum(row[idx("cancelled")]),
          reschedules: parseNum(row[idx("reschedules")]),
          cash_collected: parseNum(row[idx("cash collected")]),
          revenue: parseNum(row[idx("revenue")])
        };

        const hasData =
          payload.new_leads + payload.dq + payload.follow_ups +
          payload.calls_pitched + payload.booked_calls + payload.calls_shown +
          payload.no_shows + payload.cancelled + payload.reschedules +
          payload.cash_collected + payload.revenue > 0;

        if (!hasData) return null;
        return payload;
      })
      .filter(Boolean) as object[];

    if (!payloads.length) {
      return NextResponse.json({ ok: true, rows_upserted: 0 });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("setter_stats")
      .upsert(payloads, { onConflict: "setter_name,date" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, rows_upserted: payloads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Setter webhook error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
