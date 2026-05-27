"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";
import { currency } from "@/lib/utils";

export function useCallsRealtime(onChange?: () => void) {
  useEffect(() => {
    if (!isSupabaseBrowserConfigured()) return;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("salescommand-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        async (payload) => {
          const next = payload.new as { status?: string; cash_collected?: number; rep_id?: string } | null;

          if (next?.status === "closed") {
            let repName = "A rep";
            if (next.rep_id) {
              const { data } = await supabase.from("reps").select("name").eq("id", next.rep_id).single();
              repName = data?.name ?? repName;
            }
            toast.success(`${repName} just closed a ${currency(next.cash_collected)} deal!`);
          } else {
            toast.info("Sales activity updated");
          }

          onChange?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onChange]);
}
