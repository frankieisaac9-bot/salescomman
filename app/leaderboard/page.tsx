import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { LeaderboardClient } from "@/components/leaderboard-client";
import { getLeaderboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { reps, calls, objections } = await getLeaderboardData();

  const products = Array.from(
    new Set(calls.map((c) => c.product_offered).filter(Boolean) as string[])
  );
  const teams = Array.from(
    new Set(reps.map((r) => r.team).filter(Boolean) as string[])
  );

  return (
    <>
      <RealtimeRefresh />
      <PageHeader
        title="Leaderboard"
        description="Rep rankings with scoreboard energy, live Supabase updates, and expandable performance context."
      />
      <LeaderboardClient
        reps={reps}
        calls={calls}
        objections={objections}
        products={products}
        teams={teams}
      />
    </>
  );
}
