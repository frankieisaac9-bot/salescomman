import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  fetchGoogleSheetRows,
  readDate,
  readNumber,
  readObjections,
  readStatus,
  readString,
  verifyGoogleSheetsSyncSecret
} from "@/lib/sheets";

export async function POST(request: Request) {
  if (!verifyGoogleSheetsSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid sync secret" }, { status: 401 });
  }

  const postCallSheetId = process.env.GOOGLE_SHEETS_POST_CALL_ID;
  const postCallRange = process.env.GOOGLE_SHEETS_POST_CALL_RANGE ?? "Sheet1!A:Z";

  if (!postCallSheetId) {
    return NextResponse.json({ error: "Missing GOOGLE_SHEETS_POST_CALL_ID" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    // 1. Fetch all rows from sheet
    const rows = await fetchGoogleSheetRows(postCallSheetId, postCallRange);

    // 2. Load all reps once into a name→id map
    const { data: repsData } = await supabase.from("reps").select("id, name");
    const repMap = new Map<string, string>();
    for (const rep of repsData ?? []) {
      repMap.set(rep.name.toLowerCase().trim(), rep.id);
    }

    const findRepId = (name: string | null): string | null => {
      if (!name) return null;
      const n = name.toLowerCase().trim();
      for (const [key, id] of Array.from(repMap.entries())) {
        if (key.includes(n) || n.includes(key)) return id;
      }
      return null;
    };

    // 3. Find already-imported row IDs so we don't double-insert
    const { data: imported } = await supabase
      .from("sheet_imports")
      .select("external_row_id")
      .eq("source", "post_call");
    const importedIds = new Set((imported ?? []).map((r) => String(r.external_row_id)));

    const newRows = rows.filter((row) => !importedIds.has(String(row.row_number)));

    if (newRows.length === 0) {
      return NextResponse.json({ ok: true, post_call: { rows_read: rows.length, calls_upserted: 0, leads_upserted: 0, message: "All rows already imported" } });
    }

    // 4. Build call payloads for all new rows
    const callPayloads = newRows.map((row) => {
      const repName = readString(row, ["sales rep name", "rep", "rep name", "closer", "sales rep"]);
      return {
        _row_number: String(row.row_number),
        rep_id: findRepId(repName),
        contact_id: readString(row, ["lead email (must be same as in crm)", "lead email", "contact_id", "email"]),
        status: readStatus(row),
        product_offered: readString(row, ["product", "product offered", "offer"]) ?? "SuperHuman",
        outcome: readString(row, ["general notes", "outcome", "notes"]),
        cash_collected: readNumber(row, ["cash collected (in this format: 3000) do not use \"$\" or \",\"", "cash collected", "cash"]),
        revenue_generated: readNumber(row, ["revenue generated (in this format: 3000) do not use \"$\" or \",\"", "revenue generated", "revenue"]),
        call_recording_url: readString(row, ["call recording (mandatory)", "call recording url", "recording", "loom"]),
        call_date: readDate(row, ["date", "call date", "timestamp"])
      };
    });

    // 5. Bulk insert calls (no dedup key since PCF has no opportunity ID)
    const { data: insertedCalls, error: callsError } = await supabase
      .from("calls")
      .insert(callPayloads.map(({ _row_number: _, ...payload }) => payload))
      .select("id, rep_id, status, contact_id");

    if (callsError) throw new Error(callsError.message);

    // 6. Mark rows as imported
    await supabase.from("sheet_imports").insert(
      newRows.map((row) => ({
        source: "post_call",
        external_row_id: String(row.row_number),
        payload: row,
        processed_at: new Date().toISOString()
      }))
    );

    const calls = insertedCalls ?? [];

    // 7. Bulk upsert leads for non-closed calls
    const leadPayloads = calls
      .filter((c) => c.status !== "closed" && c.contact_id)
      .map((c) => ({
        rep_id: c.rep_id,
        contact_id: c.contact_id,
        close_contact_id: c.contact_id,
        status: "pending" as const,
        flag_level: "none" as const,
        call_date: callPayloads.find((_, i) => calls[i]?.id === c.id)?.call_date ?? new Date().toISOString()
      }));

    let leadsUpserted = 0;
    if (leadPayloads.length) {
      const { error: leadsError } = await supabase
        .from("leads")
        .upsert(leadPayloads, { onConflict: "close_contact_id" });
      if (leadsError) console.error("Leads upsert error:", leadsError.message);
      else leadsUpserted = leadPayloads.length;
    }

    // 8. Insert objections for calls that have them
    const objectionPayloads: { call_id: string; rep_id: string | null; type: string; notes: string | null }[] = [];
    calls.forEach((call, index) => {
      const row = newRows[index];
      if (!row) return;
      const objections = readObjections(row);
      objections.forEach((obj) => {
        objectionPayloads.push({ call_id: call.id, rep_id: call.rep_id, type: obj.type, notes: obj.notes });
      });
    });

    if (objectionPayloads.length) {
      await supabase.from("objections").insert(objectionPayloads);
    }

    return NextResponse.json({
      ok: true,
      post_call: {
        rows_read: rows.length,
        new_rows: newRows.length,
        calls_upserted: calls.length,
        leads_upserted: leadsUpserted,
        objections_inserted: objectionPayloads.length
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Sheets sync error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
