import { PageHeader } from "@/components/page-header";
import { TrophyRoomClient } from "@/components/trophy-room-client";
import { getTrophyData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function TrophyRoomPage() {
  const { trophies, reps, calls } = await getTrophyData();

  return (
    <>
      <PageHeader
        title="Trophy Room"
        description="Winning call library with gold-card treatment, replay modals, tags, and celebratory promotion workflows."
      />
      <TrophyRoomClient trophies={trophies} reps={reps} calls={calls} />
    </>
  );
}
