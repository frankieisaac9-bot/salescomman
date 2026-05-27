import { PageHeader } from "@/components/page-header";
import { ClosersClient } from "@/components/closers-client";
import { getCloserCalls } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ClosersPage() {
  const { calls } = await getCloserCalls();
  return (
    <>
      <PageHeader
        title="Closers"
        description="Per-rep performance from post-call forms — show rate, close rate, cash collected, and full call log."
      />
      <ClosersClient calls={calls} />
    </>
  );
}
