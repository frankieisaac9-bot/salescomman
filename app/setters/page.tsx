import { PageHeader } from "@/components/page-header";
import { SettersClient } from "@/components/setters-client";
import { getSetterStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettersPage() {
  const { stats } = await getSetterStats();
  return (
    <>
      <PageHeader
        title="Setters"
        description="Daily setter performance — new leads, booked calls, show rate, and cash collected."
      />
      <SettersClient stats={stats} />
    </>
  );
}
