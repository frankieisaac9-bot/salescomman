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

        const payload: Record<string, unknown> = {
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
        };
        // Only set cash fields if the cell is non-empty
        const rawCash = String(row[idx("cash collected")] ?? "").trim();
        const rawRevenue = String(row[idx("revenue")] ?? "").trim();
        if (rawCash) payload.cash_collected = parseNum(row[idx("cash collected")]);
        if (rawRevenue) payload.revenue = parseNum(row[idx("revenue")]);

        const numericSum = (payload.new_leads as number) + (payload.dq as number) +
          (payload.follow_ups as number) + (payload.calls_pitched as number) +
          (payload.booked_calls as number) + (payload.calls_shown as number) +
          (payload.no_shows as number) + (payload.cancelled as number) +
          (payload.reschedules as number) +
          (rawCash ? parseNum(row[idx("cash collected")]) : 0) +
          (rawRevenue ? parseNum(row[idx("revenue")]) : 0);
        const hasData = numericSum > 0;

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
