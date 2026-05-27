import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const resources = new Set(["calls", "leads", "leaderboard"]);

export async function GET(_: Request, { params }: { params: { resource: string } }) {
  if (!resources.has(params.resource)) {
    return NextResponse.json({ error: "Unknown export resource" }, { status: 404 });
  }

  const supabase = createSupabaseAdminClient();
  const table = params.resource === "leaderboard" ? "calls" : params.resource;
  const { data, error } = await supabase.from(table).select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const csv = toCsv(data ?? []);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="salescommand-${params.resource}.csv"`
    }
  });
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) =>
    headers
      .map((header) => {
        const value = row[header] ?? "";
        return `"${String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
      })
      .join(",")
  );
  return [headers.join(","), ...body].join("\n");
}
