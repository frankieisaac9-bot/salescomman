import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  // Close.com controls only appear on deployments that have the API key configured
  const closeEnabled = Boolean(process.env.CLOSE_API_KEY);
  return (
    <>
      <PageHeader title="Settings" description="Admin controls for reps, products, follow-up thresholds, sheet syncs, and CSV exports." />
      <SettingsClient closeEnabled={closeEnabled} />
    </>
  );
}
