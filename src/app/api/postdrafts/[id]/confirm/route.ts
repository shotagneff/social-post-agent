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

    const result = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const current = await txAny.postDraft.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!current) return { kind: "not_found" as const };

      if (current.status === "CONFIRMED") {
        return { kind: "already" as const };
      }

      if (current.status !== "TEMP_SCHEDULED") {
        return { kind: "invalid" as const, status: current.status };
      }

      const postDraft = await txAny.postDraft.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          confirmedAt,
        },
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

      await txAny.schedule.updateMany({
        where: {
          postDraftId: id,
          status: "waiting",
        },
        data: {
          isConfirmed: true,
        },
      });

      const schedules = await txAny.schedule.findMany({
        where: { postDraftId: id },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: { id: true, scheduledAt: true, status: true, isConfirmed: true },
      });

      return { kind: "ok" as const, postDraft, schedules };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ ok: false, error: "postDraft not found" }, { status: 404 });
    }
    if (result.kind === "invalid") {
      return NextResponse.json(
        { ok: false, error: `postDraft status must be TEMP_SCHEDULED (current=${result.status})` },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
