import { PageHeader } from "@/components/page-header";
import { LeadsClient } from "@/components/leads-client";
import { getLeadsData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { leads, reps } = await getLeadsData();

  return (
    <>
      <PageHeader
        title="Lead Follow-Up Tracker"
        description="All non-closed opportunities with auto-flagging based on days since call and inline follow-up status workflows."
      />
      <LeadsClient initialLeads={leads} reps={reps} />
    </>
  );
}
