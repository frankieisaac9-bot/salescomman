import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Admin controls for reps, Close.com credentials, products, follow-up thresholds, sync, and CSV exports." />
      <SettingsClient />
    </>
  );
}
