// Shared objection mapping — single source of truth for the Objections page
// and the dashboard breakdown so their numbers always agree.

export type ObjType = "money_logistics" | "money_fear" | "partner" | "think_about_it" | "fear_of_failure" | "na";

export const OBJ_LABELS: Record<ObjType, string> = {
  money_logistics: "Money Logistics",
  money_fear: "Money Fear",
  partner: "Partner",
  think_about_it: "Think About It",
  fear_of_failure: "Fear of Failure",
  na: "N/A",
};

export function mapObstacle(raw: string): ObjType | null {
  const v = raw.toLowerCase().trim();
  if (!v) return null;
  if (v.includes("money") && v.includes("log")) return "money_logistics";
  if (v.includes("money") && (v.includes("fear") || v.includes("scare"))) return "money_fear";
  if (v.includes("money") || v.includes("logistics") || v.includes("financial") || v.includes("price") || v.includes("cost")) return "money_logistics";
  if (v.includes("partner")) return "partner";
  if (v.includes("fear") && v.includes("fail")) return "fear_of_failure";
  if (v.includes("fear")) return "fear_of_failure";
  if (v.includes("think")) return "think_about_it";
  if (v === "n/a" || v === "na") return "na";
  return null;
}

export function isOvercome(leadStatus: string | null): boolean {
  const s = (leadStatus ?? "").toLowerCase();
  return s.includes("closed") || s.includes("deposit") || s.includes("won");
}

// Jan..Dec of the current year plus "All" — used by month filter button rows.
export function buildMonthOptions(): { value: string; label: string }[] {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = `${year}-${String(i + 1).padStart(2, "0")}`;
    const label = new Date(year, i, 1).toLocaleString("default", { month: "short" });
    return { value, label };
  });
  return [...months, { value: "all", label: "All" }];
}
