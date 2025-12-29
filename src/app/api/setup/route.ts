import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type SetupBody = {
  workspaceName?: string;
  timezone?: string;
  postingTargets?: Platform[];
  personaProfileJson?: string;
  narratorProfileJson?: string;
  genreKey?: string;
  genreProfileJson?: string;
  sourceAccounts?: Array<{
    platform?: Platform;
    handle?: string;
    displayName?: string;
    isActive?: boolean;
    memo?: string;
    weight?: number;
  }>;
};

function normalizeHandle(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function isValidHandle(platform: Platform, handle: string) {
  const h = normalizeHandle(handle);
  if (!h) return false;
  const body = h.slice(1);
  if (!body) return false;
  if (platform === "X") return /^[A-Za-z0-9_]{1,15}$/.test(body);
  return /^[A-Za-z0-9._]{1,30}$/.test(body);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as SetupBody;

    const workspaceName = String(body.workspaceName ?? "").trim();
    if (!workspaceName) {
      return NextResponse.json(
        { ok: false, error: "workspaceName is required" },
        { status: 400 },
      );
    }

    const timezone = String(body.timezone ?? "Asia/Tokyo").trim() || "Asia/Tokyo";

    const postingTargetsRaw = Array.isArray(body.postingTargets)
      ? body.postingTargets.filter((p): p is Platform => p === "X" || p === "THREADS")
      : [];

    const postingTargets: Platform[] = postingTargetsRaw.length > 0 ? postingTargetsRaw : ["X", "THREADS"];

    const narratorProfileJsonRaw = body.narratorProfileJson;
    const narratorProfileJson =
      narratorProfileJsonRaw === undefined ? null : String(narratorProfileJsonRaw ?? "{}").trim();
    let narratorProfile: unknown = null;
    if (narratorProfileJson) {
      try {
        narratorProfile = JSON.parse(narratorProfileJson);
      } catch {
        return NextResponse.json(
          { ok: false, error: "narratorProfileJson must be valid JSON" },
          { status: 400 },
        );
      }
    }

    const sourceAccountsInput = Array.isArray(body.sourceAccounts) ? body.sourceAccounts : [];
    const sourceAccounts = sourceAccountsInput
      .map((s) => ({
        platform: s.platform,
        handle: normalizeHandle(String(s.handle ?? "")),
        displayName: s.displayName ? String(s.displayName) : undefined,
        isActive: s.isActive ?? true,
        memo: s.memo ? String(s.memo) : undefined,
        weight: typeof s.weight === "number" ? s.weight : undefined,
      }))
      .filter((s) => (s.platform === "X" || s.platform === "THREADS") && isValidHandle(s.platform, s.handle));

    const workspace = await prisma.workspace.create({
      data: {
        name: workspaceName,
      },
    });

    await prisma.workspaceSettings.create({
      data: {
        workspaceId: workspace.id,
        timezone,
        postingTargets,
        fixedPersonaId: null,
        defaultGenreId: null,
        narratorProfile: narratorProfile as any,
      },
    });

    if (sourceAccounts.length > 0) {
      await prisma.sourceAccount.createMany({
        data: sourceAccounts.map((s) => ({
          workspaceId: workspace.id,
          platform: s.platform as any,
          handle: s.handle,
          displayName: s.displayName ?? null,
          isActive: s.isActive,
          memo: s.memo ?? null,
          weight: s.weight ?? null,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      ok: true,
      workspaceId: workspace.id,
      personaId: null,
      genreId: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
