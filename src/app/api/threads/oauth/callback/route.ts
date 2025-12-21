import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const redirectToConnect = (args: { workspaceId?: string; result: "ok" | "ng"; message: string }) => {
    const dst = new URL("/threads/connect", url.origin);
    if (args.workspaceId) dst.searchParams.set("workspaceId", args.workspaceId);
    dst.searchParams.set("result", args.result);
    dst.searchParams.set("message", args.message);
    return NextResponse.redirect(dst.toString());
  };

  try {
    const code = String(url.searchParams.get("code") ?? "").trim();
    const stateParam = String(url.searchParams.get("state") ?? "").trim();

    if (!code) {
      return redirectToConnect({ result: "ng", message: "認可コード(code)が見つかりませんでした。" });
    }

    if (!stateParam) {
      return redirectToConnect({ result: "ng", message: "stateが見つかりませんでした。" });
    }

    const idx = stateParam.lastIndexOf(".");
    const state = idx >= 0 ? stateParam.slice(0, idx) : stateParam;
    const workspaceId = idx >= 0 ? stateParam.slice(idx + 1) : "";

    const cookieStore = await cookies();
    const cookieState = cookieStore.get("threads_oauth_state")?.value ?? "";
    if (!cookieState || cookieState !== state) {
      return redirectToConnect({
        workspaceId: workspaceId || undefined,
        result: "ng",
        message: "認証情報（state）の検証に失敗しました。もう一度『接続する』からやり直してください。",
      });
    }

    if (!workspaceId) {
      return redirectToConnect({
        result: "ng",
        message: "workspaceIdの取得に失敗しました。もう一度『接続する』からやり直してください。",
      });
    }

    const clientId = mustEnv("THREADS_OAUTH_CLIENT_ID");
    const clientSecret = mustEnv("THREADS_OAUTH_CLIENT_SECRET");

    const redirectUri =
      process.env.THREADS_OAUTH_REDIRECT_URI?.trim() || new URL("/api/threads/oauth/callback", url.origin).toString();

    const tokenUrl = new URL(`https://graph.threads.net/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetchJson(tokenUrl.toString());
    if (!tokenRes.res.ok) {
      const errMsg =
        (tokenRes.json?.error?.message as string | undefined) ||
        `${tokenRes.res.status} ${tokenRes.text || "token交換に失敗しました"}`;
      return redirectToConnect({
        workspaceId,
        result: "ng",
        message: `アクセストークンの取得に失敗しました: ${errMsg}`,
      });
    }

    const accessToken = String(tokenRes.json?.access_token ?? "").trim();
    const expiresIn = Number(tokenRes.json?.expires_in ?? 0) || 0;

    if (!accessToken) {
      return redirectToConnect({
        workspaceId,
        result: "ng",
        message: "アクセストークンが取得できませんでした。",
      });
    }

    const meUrl = new URL(`https://graph.threads.net/me`);
    meUrl.searchParams.set("fields", "id");
    meUrl.searchParams.set("access_token", accessToken);

    const meRes = await fetchJson(meUrl.toString());
    if (!meRes.res.ok) {
      const errMsg =
        (meRes.json?.error?.message as string | undefined) || `${meRes.res.status} ${meRes.text || "me取得に失敗"}`;
      return redirectToConnect({
        workspaceId,
        result: "ng",
        message: `Threadsユーザー情報の取得に失敗しました: ${errMsg}`,
      });
    }

    const userId = String(meRes.json?.id ?? "").trim();
    if (!userId) {
      return redirectToConnect({
        workspaceId,
        result: "ng",
        message: "Threads user_id が取得できませんでした。",
      });
    }

    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

    await prismaAny.workspaceSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Tokyo",
        postingTargets: [],
        schedulingPolicy: {},
        threadsAccessToken: accessToken,
        threadsUserId: userId,
        threadsTokenExpiresAt: expiresAt,
      },
      update: {
        threadsAccessToken: accessToken,
        threadsUserId: userId,
        threadsTokenExpiresAt: expiresAt,
      },
      select: { id: true },
    });

    const res = redirectToConnect({ workspaceId, result: "ok", message: "Threads連携が完了しました。" });
    res.cookies.set({
      name: "threads_oauth_state",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return redirectToConnect({ result: "ng", message: `エラー: ${message}` });
  }
}
