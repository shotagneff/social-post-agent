import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type SetupBody = {
  workspaceName?: string;
  timezone?: string;
  postingTargets?: Platform[];
  personaProfileJson?: string;
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

function parseJsonOrThrow(value: string, fieldName: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
}

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

    const postingTargets = Array.isArray(body.postingTargets)
      ? body.postingTargets.filter((p): p is Platform => p === "X" || p === "THREADS")
      : [];

    const personaProfileJson = String(body.personaProfileJson ?? "{}").trim() || "{}";
    const personaProfile = parseJsonOrThrow(personaProfileJson, "personaProfileJson");

    const genreKey = String(body.genreKey ?? "default").trim() || "default";

    const genreProfileJson = String(body.genreProfileJson ?? "{}").trim() || "{}";
    const genreProfile = parseJsonOrThrow(genreProfileJson, "genreProfileJson");

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

    const persona = await prisma.persona.create({
      data: {
        workspaceId: workspace.id,
        version: 1,
        profile: personaProfile,
      },
    });

    const genre = await prisma.genre.create({
      data: {
        workspaceId: workspace.id,
        key: genreKey,
        profile: genreProfile,
      },
    });

    await prisma.workspaceSettings.create({
      data: {
        workspaceId: workspace.id,
        timezone,
        postingTargets,
        fixedPersonaId: persona.id,
        defaultGenreId: genre.id,
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
      personaId: persona.id,
      genreId: genre.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
