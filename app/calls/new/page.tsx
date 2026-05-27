import { CallEntryForm } from "@/components/call-entry-form";
import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Rep } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewCallPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Log Call" description="Manual call entry with objections, revenue attribution, recording links, and optional Trophy Room promotion." />
        <CallEntryForm reps={[]} />
      </>
    );
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("reps").select("*").order("name");

  return (
    <>
      <PageHeader title="Log Call" description="Manual call entry with objections, revenue attribution, recording links, and optional Trophy Room promotion." />
      <CallEntryForm reps={(data ?? []) as Rep[]} />
    </>
  );
}
