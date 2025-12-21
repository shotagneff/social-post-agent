import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type PatchBody = {
  platform?: Platform;
  variantKey?: "A" | "B" | "C";
  text?: string;
};

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

function isVariantKey(value: unknown): value is "A" | "B" | "C" {
  return value === "A" || value === "B" || value === "C";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const draft = await prisma.draft.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        theme: true,
        status: true,
        variants: true,
        formatted: true,
        createdAt: true,
        updatedAt: true,
        approvals: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            approvedBy: true,
            note: true,
            createdAt: true,
          },
        },
        schedules: {
          orderBy: { scheduledAt: "desc" },
          select: {
            id: true,
            platform: true,
            scheduledAt: true,
            status: true,
            errorText: true,
            createdAt: true,
          },
        },
      },
    });

    if (!draft) {
      return NextResponse.json({ ok: false, error: "draft not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as PatchBody;

    if (!isPlatform(body.platform)) {
      return NextResponse.json({ ok: false, error: "platform is required" }, { status: 400 });
    }

    if (!isVariantKey(body.variantKey)) {
      return NextResponse.json(
        { ok: false, error: "variantKey must be A|B|C" },
        { status: 400 },
      );
    }

    const text = String(body.text ?? "");

    const existing = await prisma.draft.findUnique({
      where: { id },
      select: { id: true, formatted: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "draft not found" }, { status: 404 });
    }

    const formatted = (existing.formatted ?? {}) as any;
    const platform = body.platform;
    const variantKey = body.variantKey;

    const nextFormatted = {
      ...formatted,
      [platform]: {
        ...(formatted?.[platform] ?? {}),
        [variantKey]: text,
      },
    };

    const draft = await prisma.draft.update({
      where: { id },
      data: {
        formatted: nextFormatted,
        status: "EDITING",
      },
      select: {
        id: true,
        workspaceId: true,
        theme: true,
        status: true,
        variants: true,
        formatted: true,
        createdAt: true,
        updatedAt: true,
        approvals: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            approvedBy: true,
            note: true,
            createdAt: true,
          },
        },
        schedules: {
          orderBy: { scheduledAt: "desc" },
          select: {
            id: true,
            platform: true,
            scheduledAt: true,
            status: true,
            errorText: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
