import { subDays } from "date-fns";
import { createSupabaseAdminClient, createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Call, CloserCall, DailyStat, Lead, Objection, Rep, SetterStat, Trophy } from "@/lib/types";

export async function getDashboardData(days = 30, since?: string) {
  if (!isSupabaseConfigured()) return { calls: [], reps: [], objections: [], error: null };
  const supabase = createSupabaseServerClient();
  const sinceDate = since ?? subDays(new Date(), days).toISOString();

  const [calls, reps, objections] = await Promise.all([
    supabase
      .from("calls")
      .select("*, reps(*)")
      .gte("call_date", sinceDate)
      .order("call_date", { ascending: true }),
    supabase.from("reps").select("*").order("name"),
    supabase.from("objections").select("*, reps(*), calls(*)").gte("created_at", sinceDate)
  ]);

  return {
    calls: (calls.data ?? []) as Call[],
    reps: (reps.data ?? []) as Rep[],
    objections: (objections.data ?? []) as Objection[],
    error: calls.error ?? reps.error ?? objections.error
  };
}

export async function getLeaderboardData() {
  if (!isSupabaseConfigured()) return { calls: [], reps: [], objections: [], error: null };
  const supabase = createSupabaseServerClient();
  const [calls, reps, objections] = await Promise.all([
    supabase.from("calls").select("*, reps(*)").order("call_date", { ascending: false }),
    supabase.from("reps").select("*").order("name"),
    supabase.from("objections").select("*")
  ]);

  return {
    calls: (calls.data ?? []) as Call[],
    reps: (reps.data ?? []) as Rep[],
    objections: (objections.data ?? []) as Objection[],
    error: calls.error ?? reps.error ?? objections.error
  };
}

export async function getLeadsData() {
  if (!isSupabaseConfigured()) return { leads: [], reps: [], error: null };
  const supabase = createSupabaseServerClient();
  const [leads, reps] = await Promise.all([
    supabase.from("leads").select("*, reps(*)").order("call_date", { ascending: false }),
    supabase.from("reps").select("*").order("name")
  ]);

  return {
    leads: (leads.data ?? []) as Lead[],
    reps: (reps.data ?? []) as Rep[],
    error: leads.error ?? reps.error
  };
}

export async function getTrophyData() {
  if (!isSupabaseConfigured()) return { trophies: [], reps: [], calls: [], error: null };
  const supabase = createSupabaseServerClient();
  const [trophies, reps, calls] = await Promise.all([
    supabase.from("trophy_room").select("*, reps(*), calls(*)").order("created_at", { ascending: false }),
    supabase.from("reps").select("*").order("name"),
    supabase.from("calls").select("*, reps(*)").eq("status", "closed").order("call_date", { ascending: false })
  ]);

  return {
    trophies: (trophies.data ?? []) as Trophy[],
    reps: (reps.data ?? []) as Rep[],
    calls: (calls.data ?? []) as Call[],
    error: trophies.error ?? reps.error ?? calls.error
  };
}

export async function getObjectionsData() {
  if (!isSupabaseConfigured()) return { objections: [], reps: [], error: null };
  const supabase = createSupabaseServerClient();
  const [objections, reps] = await Promise.all([
    supabase
      .from("objections")
      .select("*, reps(*), calls(*)")
      .order("created_at", { ascending: false }),
    supabase.from("reps").select("*").order("name")
  ]);

  return {
    objections: (objections.data ?? []) as Objection[],
    reps: (reps.data ?? []) as Rep[],
    error: objections.error ?? reps.error
  };
}

export async function getDailyStats(since?: string) {
  if (!isSupabaseConfigured()) return { stats: [], reps: [], error: null };
  const supabase = createSupabaseAdminClient();

  const baseQuery = supabase
    .from("daily_stats")
    .select("*, reps(*)")
    .order("date", { ascending: true });
  const query = since ? baseQuery.gte("date", since) : baseQuery;

  const [stats, reps] = await Promise.all([
    query,
    supabase.from("reps").select("*").order("name")
  ]);

  return {
    stats: (stats.data ?? []) as DailyStat[],
    reps: (reps.data ?? []) as Rep[],
    error: stats.error ?? reps.error
  };
}

export async function getSetterStats(since?: string) {
  if (!isSupabaseConfigured()) return { stats: [], error: null };
  const supabase = createSupabaseAdminClient();
  const baseQuery = supabase
    .from("setter_stats")
    .select("*")
    .order("date", { ascending: true });
  const query = since ? baseQuery.gte("date", since) : baseQuery;
  const { data, error } = await query;
  return { stats: (data ?? []) as SetterStat[], error };
}

export async function getCloserCalls() {
  if (!isSupabaseConfigured()) return { calls: [], error: null };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("closer_calls")
    .select("*")
    .order("date", { ascending: true });
  return { calls: (data ?? []) as CloserCall[], error };
}
