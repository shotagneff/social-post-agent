import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type ScheduleBody = {
  platform?: Platform;
  scheduledAt?: string;
};

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as ScheduleBody;

    if (!isPlatform(body.platform)) {
      return NextResponse.json({ ok: false, error: "platform is required" }, { status: 400 });
    }

    const platform = body.platform;

    const scheduledAtRaw = String(body.scheduledAt ?? "").trim();
    if (!scheduledAtRaw) {
      return NextResponse.json(
        { ok: false, error: "scheduledAt is required" },
        { status: 400 },
      );
    }

    const scheduledAt = new Date(scheduledAtRaw);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { ok: false, error: "scheduledAt must be a valid datetime" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!draft) return null;

      if (draft.status !== "APPROVED") {
        return { error: "draft must be APPROVED before scheduling" } as const;
      }

      await tx.schedule.create({
        data: {
          draftId: id,
          platform,
          scheduledAt,
          status: "waiting",
          isConfirmed: true,
        },
      });

      const updatedDraft = await tx.draft.update({
        where: { id },
        data: { status: "SCHEDULED" },
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
            select: { id: true, approvedBy: true, note: true, createdAt: true },
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

      return updatedDraft;
    });

    if (!result) {
      return NextResponse.json({ ok: false, error: "draft not found" }, { status: 404 });
    }

    if ((result as any).error) {
      return NextResponse.json({ ok: false, error: (result as any).error }, { status: 409 });
    }

    return NextResponse.json({ ok: true, draft: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
