import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

export async function DELETE(_req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const result = await prismaAny.$transaction(async (tx: any) => {
      const schedule = await tx.schedule.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          published: { select: { id: true } },
          draftId: true,
          postDraftId: true,
          slotId: true,
        },
      });

      if (!schedule) return { kind: "not_found" as const };

      if (schedule.published) {
        return { kind: "invalid" as const, error: "already posted" };
      }

      if (schedule.status !== "waiting") {
        return { kind: "invalid" as const, error: `status must be waiting (current=${schedule.status})` };
      }

      if (!schedule.postDraftId) {
        return { kind: "invalid" as const, error: "only PostDraft schedules can be cancelled currently" };
      }

      await tx.schedule.delete({ where: { id } });

      if (schedule.slotId) {
        await tx.schedulingSlot.updateMany({
          where: { id: schedule.slotId, assignedPostDraftId: schedule.postDraftId },
          data: { assignedPostDraftId: null },
        });
      }

      await tx.postDraft.update({
        where: { id: schedule.postDraftId },
        data: {
          status: "DRAFT_GENERATED",
          tempScheduledAt: null,
          confirmedAt: null,
        },
        select: { id: true, status: true, tempScheduledAt: true, confirmedAt: true },
      });

      return { kind: "ok" as const, scheduleId: id };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ ok: false, error: "schedule not found" }, { status: 404 });
    }

    if (result.kind === "invalid") {
      return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true, scheduleId: result.scheduleId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
