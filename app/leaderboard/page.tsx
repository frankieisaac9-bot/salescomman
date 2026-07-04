import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { LeaderboardClient } from "@/components/leaderboard-client";
import { getCloserCalls, getSetterStats, getTrackingStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const [{ stats }, { stats: setterStats }, { calls: closerCalls }] = await Promise.all([
    getTrackingStats(),
    getSetterStats(),
    getCloserCalls()
  ]);

  return (
    <>
      <RealtimeRefresh />
      <PageHeader
        title="Leaderboard"
        description="Closer and setter rankings from the tracking sheets — cash collected, close rates, and booked calls."
      />
      <LeaderboardClient stats={stats} setterStats={setterStats} closerCalls={closerCalls} />
    </>
  );
}
