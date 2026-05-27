"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useCallsRealtime } from "@/hooks/use-calls-realtime";

export function RealtimeRefresh() {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useCallsRealtime(refresh);
  return null;
}
