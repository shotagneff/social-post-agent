import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = String(url.searchParams.get("workspaceId") ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
    }

    const clientId = mustEnv("THREADS_OAUTH_CLIENT_ID");

    const redirectUri =
      process.env.THREADS_OAUTH_REDIRECT_URI?.trim() ||
      new URL("/api/threads/oauth/callback", url.origin).toString();

    const scopes = (process.env.THREADS_OAUTH_SCOPES ?? "threads_basic,threads_content_publish").trim();

    const state = crypto.randomBytes(24).toString("hex");

    const authUrl = new URL(`https://www.facebook.com/v19.0/dialog/oauth`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", `${state}.${workspaceId}`);

    const res = NextResponse.redirect(authUrl.toString());
    res.cookies.set({
      name: "threads_oauth_state",
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
