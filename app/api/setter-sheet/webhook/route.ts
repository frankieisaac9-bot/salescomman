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

const ZERO_ROW = {
  new_leads: 0, dq: 0, follow_ups: 0, calls_pitched: 0,
  booked_calls: 0, calls_shown: 0, no_shows: 0, cancelled: 0,
  reschedules: 0, cash_collected: 0, revenue: 0
};

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

    // Build payloads for ALL valid rows (date + setter name present)
    const payloads: Record<string, unknown>[] = [];
    const sheetKeys = new Set<string>(); // "setterName|date"

    for (const row of dataRows) {
      const dateStr = parseSetterDate(String(row[idx("date")] ?? ""));
      if (!dateStr) continue;
      const setterName = String(row[idx("setter name")] ?? "").trim();
      if (!setterName) continue;

      sheetKeys.add(`${setterName}|${dateStr}`);

      payloads.push({
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
      });
    }

    if (!payloads.length) {
      return NextResponse.json({ ok: true, rows_upserted: 0 });
    }

    const supabase = createSupabaseAdminClient();

    // Upsert all current sheet rows (overwrites everything with live values)
    const { error } = await supabase
      .from("setter_stats")
      .upsert(payloads, { onConflict: "setter_name,date" });

    if (error) throw new Error(error.message);

    // Zero out any DB rows for these setters that no longer exist in the sheet
    // (handles deleted rows — sheet is always the source of truth)
    const setterNames = Array.from(new Set(payloads.map(p => p.setter_name as string)));
    const { data: dbRows } = await supabase
      .from("setter_stats")
      .select("setter_name,date")
      .in("setter_name", setterNames);

    const staleRows = (dbRows ?? []).filter(
      r => !sheetKeys.has(`${r.setter_name}|${r.date}`)
    );

    if (staleRows.length > 0) {
      await supabase
        .from("setter_stats")
        .upsert(
          staleRows.map(r => ({ setter_name: r.setter_name, date: r.date, ...ZERO_ROW })),
          { onConflict: "setter_name,date" }
        );
    }

    return NextResponse.json({ ok: true, rows_upserted: payloads.length, stale_zeroed: staleRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Setter webhook error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
