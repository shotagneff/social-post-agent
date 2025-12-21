import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

type Platform = "X" | "THREADS";

type AssignBody = {
  workspaceId?: string;
  platform?: Platform;
  limit?: number;
};

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as AssignBody;
    const workspaceId = String(body.workspaceId ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
    }

    const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50) || 50));
    const platform = body.platform;
    if (platform !== undefined && !isPlatform(platform)) {
      return NextResponse.json({ ok: false, error: "platform must be X|THREADS" }, { status: 400 });
    }

    const totalSlots = await prismaAny.schedulingSlot.count({
      where: {
        workspaceId,
        ...(platform ? { platform } : {}),
      },
    });

    const unassignedSlots = await prismaAny.schedulingSlot.count({
      where: {
        workspaceId,
        assignedPostDraftId: null,
        ...(platform ? { platform } : {}),
      },
    });

    const draftGenerated = await prismaAny.postDraft.count({
      where: {
        workspaceId,
        status: "DRAFT_GENERATED",
        ...(platform ? { platform } : {}),
      },
    });

    const slots = await prismaAny.schedulingSlot.findMany({
      where: {
        workspaceId,
        assignedPostDraftId: null,
        ...(platform ? { platform } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      select: { id: true, platform: true, scheduledAt: true },
    });

    if (slots.length === 0) {
      return NextResponse.json({
        ok: true,
        assigned: 0,
        reason: totalSlots === 0 ? "no_slots_generated" : "no_slots_available",
        diagnostics: { totalSlots, unassignedSlots, draftGenerated, limit, platform: platform ?? null },
        hint:
          totalSlots === 0
            ? "投稿枠（投稿時間）がまだ生成されていません。/setup で『保存して投稿枠を生成』を実行してください。"
            : "投稿枠の空きがありません。期間を延ばして投稿枠を追加生成するか、件数を減らしてください。",
      });
    }

    const postDrafts = await prismaAny.postDraft.findMany({
      where: {
        workspaceId,
        status: "DRAFT_GENERATED",
        ...(platform ? { platform } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: slots.length,
      select: { id: true, platform: true },
    });

    if (postDrafts.length === 0) {
      return NextResponse.json({
        ok: true,
        assigned: 0,
        reason: "no_postdrafts",
        diagnostics: { totalSlots, unassignedSlots, draftGenerated, limit, platform: platform ?? null },
        hint: "仮予約対象の投稿案がありません。先に『大量生成して仮予約を作成』で投稿案を作ってください。",
      });
    }

    const pairs: Array<{ slotId: string; platform: Platform; scheduledAt: Date; postDraftId: string }> = [];

    const byPlatform: Record<Platform, string[]> = { X: [], THREADS: [] };
    for (const pd of postDrafts) {
      byPlatform[pd.platform as Platform].push(pd.id);
    }

    for (const s of slots) {
      const arr = byPlatform[s.platform as Platform];
      const postDraftId = arr.shift();
      if (!postDraftId) continue;
      pairs.push({ slotId: s.id, platform: s.platform as Platform, scheduledAt: s.scheduledAt, postDraftId });
    }

    let assigned = 0;
    const results: Array<{ slotId: string; postDraftId: string; scheduleId: string }> = [];

    for (const p of pairs) {
      const r = await prismaAny.$transaction(async (tx: any) => {
        const claimed = await tx.schedulingSlot.updateMany({
          where: { id: p.slotId, assignedPostDraftId: null },
          data: { assignedPostDraftId: p.postDraftId },
        });

        if (claimed.count === 0) {
          return null;
        }

        const existing = await tx.schedule.findFirst({
          where: { slotId: p.slotId },
          select: { id: true },
        });

        if (existing) {
          // Slot is already used; revert claim.
          await tx.schedulingSlot.updateMany({
            where: { id: p.slotId, assignedPostDraftId: p.postDraftId },
            data: { assignedPostDraftId: null },
          });
          return null;
        }

        await tx.postDraft.update({
          where: { id: p.postDraftId },
          data: {
            status: "TEMP_SCHEDULED",
            tempScheduledAt: p.scheduledAt,
          },
        });

        const schedule = await tx.schedule.create({
          data: {
            postDraftId: p.postDraftId,
            platform: p.platform as any,
            scheduledAt: p.scheduledAt,
            status: "waiting",
            isConfirmed: false,
            slotId: p.slotId,
          },
          select: { id: true },
        });

        return { scheduleId: schedule.id };
      });

      if (r) {
        assigned += 1;
        results.push({ slotId: p.slotId, postDraftId: p.postDraftId, scheduleId: r.scheduleId });
      }
    }

    return NextResponse.json({
      ok: true,
      assigned,
      results,
      diagnostics: { totalSlots, unassignedSlots, draftGenerated, limit, platform: platform ?? null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
