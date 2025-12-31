import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Body = {
  confirmedAt?: string;
};

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const confirmedAt = body.confirmedAt ? new Date(body.confirmedAt) : new Date();
    if (Number.isNaN(confirmedAt.getTime())) {
      return NextResponse.json({ ok: false, error: "confirmedAt must be ISO date" }, { status: 400 });
    }

    const prismaAny = prisma as any;

    const current = await prismaAny.postDraft.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!current) {
      return NextResponse.json({ ok: false, error: "postDraft not found" }, { status: 404 });
    }

    if (current.status === "CONFIRMED") {
      const schedules = await prismaAny.schedule.findMany({
        where: { postDraftId: id },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: { id: true, scheduledAt: true, status: true, isConfirmed: true },
      });
      return NextResponse.json({ ok: true, kind: "already", schedules });
    }

    if (current.status !== "TEMP_SCHEDULED") {
      return NextResponse.json(
        { ok: false, error: `postDraft status must be TEMP_SCHEDULED (current=${current.status})` },
        { status: 409 },
      );
    }

    const [updatedCount, _schedulesUpdated, schedules] = await prisma.$transaction([
      prismaAny.postDraft.updateMany({
        where: { id, status: "TEMP_SCHEDULED" },
        data: { status: "CONFIRMED", confirmedAt },
      }),
      prismaAny.schedule.updateMany({
        where: { postDraftId: id, status: "waiting" },
        data: { isConfirmed: true },
      }),
      prismaAny.schedule.findMany({
        where: { postDraftId: id },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: { id: true, scheduledAt: true, status: true, isConfirmed: true },
      }),
    ]);

    if (Number(updatedCount?.count ?? 0) === 0) {
      const latest = await prismaAny.postDraft.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      return NextResponse.json(
        { ok: false, error: `postDraft status must be TEMP_SCHEDULED (current=${latest?.status ?? "unknown"})` },
        { status: 409 },
      );
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
      },
    });

    return NextResponse.json({ ok: true, kind: "ok", postDraft, schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
