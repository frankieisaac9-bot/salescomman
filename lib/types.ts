export type CallStatus = "booked" | "showed" | "no_show" | "closed" | "lost";
export type ObjectionType = "partner" | "think_about_it" | "fear" | "money" | "other";
export type LeadStatus = "pending" | "followed_up" | "converted" | "dead";
export type FlagLevel = "none" | "day3" | "day7" | "day10" | "day14";

export type Rep = {
  id: string;
  name: string;
  avatar_url: string | null;
  role: "admin" | "rep" | string;
  team: string | null;
  created_at: string;
};

export type Call = {
  id: string;
  rep_id: string | null;
  contact_id: string | null;
  close_opportunity_id: string | null;
  status: CallStatus;
  product_offered: string | null;
  outcome: string | null;
  cash_collected: number | null;
  revenue_generated: number | null;
  call_recording_url: string | null;
  call_date: string;
  created_at: string;
  reps?: Rep | null;
};

export type Objection = {
  id: string;
  call_id: string | null;
  rep_id: string | null;
  type: ObjectionType;
  notes: string | null;
  created_at: string;
  reps?: Rep | null;
  calls?: Call | null;
};

export type Lead = {
  id: string;
  rep_id: string | null;
  contact_id: string | null;
  close_contact_id: string | null;
  call_date: string | null;
  last_follow_up: string | null;
  notes: string | null;
  status: LeadStatus;
  flag_level: FlagLevel;
  created_at: string;
  reps?: Rep | null;
};

export type Trophy = {
  id: string;
  rep_id: string | null;
  call_id: string | null;
  title: string;
  description: string | null;
  call_recording_url: string | null;
  thumbnail_url: string | null;
  tags: string[] | null;
  created_at: string;
  reps?: Rep | null;
  calls?: Call | null;
};

export type DailyStat = {
  id: string;
  rep_id: string | null;
  rep_name: string | null;
  date: string;
  available: number;
  booked: number;
  showed: number;
  canceled: number;
  no_show: number;
  offer: number;
  deposit: number;
  closed: number;
  cash_collected: number;
  rev_generated: number;
  created_at: string;
  reps?: Rep | null;
};

export type SetterStat = {
  id: string;
  setter_name: string;
  date: string;
  new_leads: number;
  dq: number;
  follow_ups: number;
  calls_pitched: number;
  booked_calls: number;
  calls_shown: number;
  no_shows: number;
  cancelled: number;
  reschedules: number;
  cash_collected: number;
  revenue: number;
  created_at: string;
};

export type CloserCall = {
  id: string;
  form_timestamp: string;
  rep_name: string;
  date: string;
  lead_email: string | null;
  setter: string | null;
  problem: string | null;
  goal: string | null;
  obstacles: string | null;
  prospect_job: string | null;
  notes: string | null;
  offer_made: boolean;
  lead_status: string | null;
  call_recording_url: string | null;
  cash_collected: number;
  revenue: number;
  created_at: string;
};

export type RepMetrics = {
  rep: Rep | null;
  callsBooked: number;
  showed: number;
  noShow: number;
  callsClosed: number;
  showRate: number;
  closeRate: number;
  cashCollected: number;
  revenueGenerated: number;
  topObjection: string;
  productBreakdown: Record<string, number>;
};
