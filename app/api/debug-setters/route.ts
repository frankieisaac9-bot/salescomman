import { NextResponse } from "next/server";
import { getSetterStats } from "@/lib/data";

export async function GET() {
  const { stats, error } = await getSetterStats();
  const cashRows = stats.filter((s) => Number(s.cash_collected) > 0);
  const total = stats.reduce((sum, s) => sum + Number(s.cash_collected), 0);
  return NextResponse.json({
    total_rows: stats.length,
    total_cash_collected: total,
    cash_rows: cashRows,
    error
  });
}
