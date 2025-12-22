import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

export async function DELETE() {
  try {
    const result = await prismaAny.$transaction(async (tx: any) => {
      const failed = await tx.schedule.findMany({
        where: { status: "failed" },
        select: {
          id: true,
          postDraftId: true,
          slotId: true,
          published: { select: { id: true } },
        },
      });

      const deletable = failed.filter((s: any) => !s.published);

      const postDraftIds = Array.from(
        new Set(deletable.map((s: any) => String(s.postDraftId ?? "").trim()).filter(Boolean)),
      );

      const slotIds = Array.from(
        new Set(deletable.map((s: any) => String(s.slotId ?? "").trim()).filter(Boolean)),
      );

      if (slotIds.length > 0 && postDraftIds.length > 0) {
        await tx.schedulingSlot.updateMany({
          where: { id: { in: slotIds }, assignedPostDraftId: { in: postDraftIds } },
          data: { assignedPostDraftId: null },
        });
      }

      if (postDraftIds.length > 0) {
        await tx.postDraft.updateMany({
          where: { id: { in: postDraftIds } },
          data: {
            status: "DRAFT_GENERATED",
            tempScheduledAt: null,
            confirmedAt: null,
          },
        });
      }

      const deleted = await tx.schedule.deleteMany({
        where: {
          id: { in: deletable.map((s: any) => s.id) },
          status: "failed",
        },
      });

      return { deleted: deleted.count };
    });

    return NextResponse.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
