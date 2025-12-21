import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = String(url.searchParams.get("code") ?? "").trim();

  return NextResponse.json({
    ok: true,
    status: "received",
    confirmation_code: code || null,
  });
}
