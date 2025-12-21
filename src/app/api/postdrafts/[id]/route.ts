import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

type PatchBody = {
  body?: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const postDraft = await prismaAny.postDraft.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        platform: true,
        status: true,
        body: true,
        tempScheduledAt: true,
        confirmedAt: true,
        createdAt: true,
        updatedAt: true,
        slot: {
          select: { id: true, scheduledAt: true, platform: true },
        },
        schedules: {
          orderBy: { scheduledAt: "asc" },
          take: 5,
          select: { id: true, scheduledAt: true, status: true, isConfirmed: true },
        },
      },
    });

    if (!postDraft) {
      return NextResponse.json({ ok: false, error: "postDraft not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, postDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const nextBody = body.body;

    if (nextBody !== undefined && typeof nextBody !== "string") {
      return NextResponse.json({ ok: false, error: "body must be string" }, { status: 400 });
    }

    const postDraft = await prismaAny.postDraft.update({
      where: { id },
      data: {
        ...(nextBody !== undefined ? { body: nextBody } : {}),
      },
      select: {
        id: true,
        workspaceId: true,
        platform: true,
        status: true,
        body: true,
        tempScheduledAt: true,
        confirmedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, postDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
