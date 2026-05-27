import type { CallStatus } from "@/lib/types";

const closeBaseUrl = "https://api.close.com/api/v1";

export type CloseOpportunity = {
  id: string;
  contact_id?: string;
  lead_id?: string;
  status_label?: string;
  status_id?: string;
  value?: number;
  value_period?: string;
  note?: string;
  date_created?: string;
  date_updated?: string;
  user_id?: string;
  custom?: Record<string, unknown>;
};

export type CloseContact = {
  id: string;
  lead_id?: string;
  name?: string;
  date_created?: string;
  date_updated?: string;
  user_id?: string;
  custom?: Record<string, unknown>;
};

export function getCloseApiKey() {
  return process.env.CLOSE_API_KEY ?? process.env["close.com_API_KEY"];
}

export function getCloseLocationId() {
  return process.env.CLOSE_LOCATION_ID ?? process.env["close.com_LOCATION_ID"];
}

export function mapCloseStageToStatus(stage?: string | null): CallStatus {
  const normalized = stage?.trim().toLowerCase();
  if (normalized === "booked call" || normalized === "applied" || normalized === "rescheduling" || normalized === "ghl import") return "booked";
  if (normalized === "closed" || normalized === "deposit") return "closed";
  if (normalized === "no show" || normalized === "canceled") return "no_show";
  if (normalized === "lost" || normalized === "dq" || normalized === "not interested" || normalized === "not financially qualified" || normalized === "incorrect number") return "lost";
  if (normalized === "follow up" || normalized === "closer follow up" || normalized === "short terms follow up (<7 days til close)" || normalized === "long term follow up (8+ days til close)") return "showed";
  return "booked";
}

export async function closeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = getCloseApiKey();
  if (!apiKey) throw new Error("Missing CLOSE_API_KEY");

  const response = await fetch(`${closeBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Close API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchRecentCloseOpportunities(since: string) {
  const query = encodeURIComponent(`date_updated >= "${since}"`);
  return closeFetch<{ data: CloseOpportunity[] }>(`/opportunity/?query=${query}&_limit=200`);
}

export async function fetchRecentCloseContacts(since: string) {
  const query = encodeURIComponent(`date_updated >= "${since}"`);
  return closeFetch<{ data: CloseContact[] }>(`/contact/?query=${query}&_limit=200`);
}

export function closeWebhookEventName(payload: Record<string, unknown>) {
  return String(payload.event ?? payload.event_type ?? payload.type ?? "");
}

export function closeWebhookObject<T>(payload: Record<string, unknown>) {
  return (payload.data ?? payload.object ?? payload) as T;
}
