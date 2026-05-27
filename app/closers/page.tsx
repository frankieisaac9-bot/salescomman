import { PageHeader } from "@/components/page-header";
import { ClosersClient } from "@/components/closers-client";
import { getCloserCalls, getTrackingStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ClosersPage() {
  const [{ calls }, { stats }] = await Promise.all([
    getCloserCalls(),
    getTrackingStats(),
  ]);
  return (
    <>
      <PageHeader
        title="Closers"
        description="Per-rep performance — stats from tracking sheet, full call log from post-call forms."
      />
      <ClosersClient calls={calls} stats={stats} />
    </>
  );
}
