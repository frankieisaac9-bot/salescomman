import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { closeWebhookEventName, closeWebhookObject, mapCloseStageToStatus, type CloseContact, type CloseOpportunity } from "@/lib/close";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!isValidSignature(request, rawBody)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const event = closeWebhookEventName(payload);
  const supabase = createSupabaseAdminClient();

  if (event === "opportunity.created") {
    const opportunity = closeWebhookObject<CloseOpportunity>(payload);
    await supabase.from("calls").upsert(
      {
        close_opportunity_id: opportunity.id,
        contact_id: opportunity.contact_id ?? opportunity.lead_id ?? null,
        status: "booked",
        revenue_generated: Number(opportunity.value ?? 0) / 100,
        call_date: opportunity.date_created ?? new Date().toISOString()
      },
      { onConflict: "close_opportunity_id" }
    );
  }

  if (event === "opportunity.statusChanged") {
    const opportunity = closeWebhookObject<CloseOpportunity>(payload);
    await supabase
      .from("calls")
      .update({ status: mapCloseStageToStatus(opportunity.status_label), revenue_generated: Number(opportunity.value ?? 0) / 100 })
      .eq("close_opportunity_id", opportunity.id);
  }

  if (event === "contact.created") {
    const contact = closeWebhookObject<CloseContact>(payload);
    await supabase.from("leads").upsert(
      {
        contact_id: contact.id,
        close_contact_id: contact.id,
        status: "pending",
        flag_level: "none",
        call_date: contact.date_created ?? new Date().toISOString()
      },
      { onConflict: "close_contact_id" }
    );
  }

  if (event === "appointment.noShow") {
    const opportunity = closeWebhookObject<CloseOpportunity>(payload);
    await supabase
      .from("calls")
      .update({ status: "no_show" })
      .eq("close_opportunity_id", opportunity.id);
  }

  return NextResponse.json({ ok: true, event });
}

function isValidSignature(request: Request, rawBody: string) {
  const secret = process.env.CLOSE_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = request.headers.get("x-close-signature") ?? request.headers.get("close-signature");
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const signatureBuffer = Buffer.from(signature.replace("sha256=", ""), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
}
