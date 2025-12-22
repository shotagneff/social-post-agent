import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const cronSecretConfigured = Boolean(String(process.env.CRON_SECRET ?? "").trim());

  return NextResponse.json({
    ok: true,
    cronSecretConfigured,
    recommendedSchedule: "*/5 * * * *",
    defaultLimit: 20,
  });
}
