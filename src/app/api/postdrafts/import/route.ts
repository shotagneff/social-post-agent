import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

type Platform = "X" | "THREADS";

type Body = {
  workspaceId?: string;
  platform?: Platform;
  text?: string;
  limit?: number;
};

function isPlatform(v: unknown): v is Platform {
  return v === "X" || v === "THREADS";
}

function splitPastedPosts(raw: string) {
  const src = String(raw ?? "").replace(/\r\n/g, "\n");
  const trimmed = src.trim();
  if (!trimmed) return [] as string[];

  // Priority 1: explicit delimiter lines like "---".
  const byDelimiter = trimmed
    .split(/\n\s*---+\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byDelimiter.length >= 2) return byDelimiter;

  // Priority 2: 2+ blank lines.
  const byBlank = trimmed
    .split(/\n\s*\n\s*\n+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byBlank.length >= 2) return byBlank;

  // Fallback: single item.
  return [trimmed];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const workspaceId = String(body.workspaceId ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json(
        { ok: false, error: "workspaceId is required" },
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    if (!isPlatform(body.platform)) {
      return NextResponse.json(
        { ok: false, error: "platform is required (X|THREADS)" },
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const platform = body.platform;
    const rawText = String(body.text ?? "");
    const parts = splitPastedPosts(rawText);
    const limit = Math.max(1, Math.min(200, Number(body.limit ?? parts.length) || parts.length));

    const bodies = parts
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, limit);

    if (bodies.length === 0) {
      return NextResponse.json(
        { ok: false, error: "text is empty" },
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const rows = bodies.map((b) => ({
      workspaceId,
      platform,
      body: b,
      status: "DRAFT_GENERATED" as const,
    }));

    const createdPostDrafts = await prismaAny.$transaction(
      rows.map((data: any) =>
        prismaAny.postDraft.create({
          data,
          select: { id: true, createdAt: true },
        }),
      ),
    );

    return NextResponse.json(
      { ok: true, created: createdPostDrafts.length, platform, createdPostDrafts },
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}
