import { createSign } from "crypto";
import type { CallStatus, ObjectionType } from "@/lib/types";

export type SheetSource = "numbers" | "post_call";

type GoogleTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type GoogleSheetValuesResponse = {
  range: string;
  majorDimension: string;
  values?: string[][];
};

export function verifyGoogleSheetsSyncSecret(request: Request) {
  const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
  if (!secret) return true;

  const headerSecret = request.headers.get("x-sync-secret");
  const urlSecret = new URL(request.url).searchParams.get("secret");
  return headerSecret === secret || urlSecret === secret;
}

export async function fetchGoogleSheetRows(spreadsheetId: string, range: string) {
  if (process.env.GOOGLE_SHEETS_AUTH_MODE === "public") {
    return fetchPublicGoogleSheetRows(spreadsheetId, range);
  }

  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as GoogleSheetValuesResponse;
  return valuesToObjects(data.values ?? []);
}

async function fetchPublicGoogleSheetRows(spreadsheetId: string, range: string) {
  const sheetName = range.split("!")[0] || range;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Google public CSV ${response.status}: ${await response.text()}`);
  }

  return valuesToObjects(parseCsv(await response.text()));
}

export function valuesToObjects(values: string[][]) {
  const [headers, ...rows] = values;
  if (!headers?.length) return [];

  return rows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row, index) => {
      const payload: Record<string, unknown> = { row_number: index + 2 };
      headers.forEach((header, headerIndex) => {
        payload[header] = row[headerIndex] ?? "";
      });
      return payload;
    });
}

export function readField(payload: Record<string, unknown>, names: string[]) {
  const normalized = new Map(
    Object.entries(payload).map(([key, value]) => [normalizeKey(key), value])
  );

  for (const name of names) {
    const value = normalized.get(normalizeKey(name));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }

  return null;
}

export function readString(payload: Record<string, unknown>, names: string[]) {
  const value = readField(payload, names);
  return value === null ? null : String(value).trim();
}

export function readNumber(payload: Record<string, unknown>, names: string[]) {
  const value = readField(payload, names);
  if (value === null) return 0;
  const numeric = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function readDate(payload: Record<string, unknown>, names: string[]) {
  const value = readField(payload, names);
  if (!value) return new Date().toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function readStatus(payload: Record<string, unknown>): CallStatus {
  const raw = readString(payload, ["status", "lead status", "call status", "outcome status", "close status"])?.toLowerCase();
  if (raw?.includes("closed") || raw?.includes("won")) return "closed";
  if (raw?.includes("no show") || raw?.includes("no_show")) return "no_show";
  if (raw?.includes("not financially") || raw?.includes("cancel")) return "lost";
  if (raw?.includes("showed") || raw?.includes("completed")) return "showed";
  if (raw?.includes("lost")) return "lost";
  if (raw?.includes("follow up")) return "showed";
  if (raw?.includes("resched")) return "booked";
  return "booked";
}

export function readObjections(payload: Record<string, unknown>) {
  const raw = readString(payload, [
    "objections",
    "objection",
    "objections raised",
    "main objection",
    "Obstacle: What potential obstacles do they have to overcome?\n\nAny financial issues, trust issues, partner issues, logistical, fear"
  ]);
  const notes = readString(payload, ["objection notes", "objection note", "notes", "general notes"]);
  if (!raw) return [];

  const values = raw
    .split(/[;,|]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map(toObjectionType);

  return Array.from(new Set(values)).map((type) => ({ type, notes }));
}

function getGoogleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT"
    },
    {
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    },
    privateKey
  );

  return fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    cache: "no-store"
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${await response.text()}`);
      return response.json() as Promise<GoogleTokenResponse>;
    })
    .then((token) => token.access_token);
}

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: string) {
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toObjectionType(value: string): ObjectionType {
  const v = value.toLowerCase();
  if (v.includes("money") || v.includes("logistics") || v.includes("price") || v.includes("cost") || v.includes("financial")) return "money_logistics";
  if (v.includes("partner")) return "partner";
  if (v.includes("fear")) return "fear";
  if (v.includes("think")) return "think_about_it";
  if (v.includes("n/a") || v.includes("na")) return "na";
  return "money_logistics"; // default to most common
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
