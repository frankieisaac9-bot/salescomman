import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyGoogleSheetsSyncSecret } from "@/lib/sheets";

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null;
  const slash = raw.trim().split("/");
  if (slash.length === 3) {
    const [m, d, y] = slash;
    const month = parseInt(m, 10), day = parseInt(d, 10), year = parseInt(y, 10);
    if (!isNaN(month) && !isNaN(day) && !isNaN(year))
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const date = new Date(raw);
  if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return null;
}

function parseNum(v: unknown): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

export async function POST(request: Request) {
  if (!verifyGoogleSheetsSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid sync secret" }, { status: 401 });
  }

  try {
    const body = await request.json();
    // Expects { timestamp, repName, date, email, setter, problem, goal,
    //           obstacles, job, notes, offerMade, leadStatus, recording, cash, revenue }
    const { timestamp, repName, date: rawDate, email, setter, problem, goal,
            obstacles, job, notes, offerMade, leadStatus, recording, cash, revenue } = body;

    if (!timestamp || !repName) {
      return NextResponse.json({ error: "Missing timestamp or repName" }, { status: 400 });
    }

    const dateStr = parseDate(rawDate ?? "") ?? parseDate(timestamp ?? "");
    if (!dateStr) return NextResponse.json({ error: "Could not parse date" }, { status: 400 });

    const payload = {
      form_timestamp: String(timestamp).trim(),
      rep_name: String(repName).trim(),
      date: dateStr,
      lead_email: email?.trim() || null,
      setter: setter?.trim() || null,
      problem: problem?.trim() || null,
      goal: goal?.trim() || null,
      obstacles: obstacles?.trim() || null,
      prospect_job: job?.trim() || null,
      notes: notes?.trim() || null,
      offer_made: String(offerMade ?? "").toLowerCase().trim() === "yes",
      lead_status: leadStatus?.trim() || null,
      call_recording_url: recording?.trim() || null,
      cash_collected: parseNum(cash),
      revenue: parseNum(revenue),
    };

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("closer_calls")
      .upsert(payload, { onConflict: "form_timestamp" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Closer webhook error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
