import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Admin controls for reps, products, follow-up thresholds, sheet syncs, and CSV exports." />
      <SettingsClient />
    </>
  );
}
