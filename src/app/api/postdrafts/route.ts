import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = String(searchParams.get("workspaceId") ?? "").trim();
    const take = Math.max(1, Math.min(200, Number(searchParams.get("take") ?? 50) || 50));

    const postDrafts = await prismaAny.postDraft.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: "desc" },
      take,
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
      },
    });

    return NextResponse.json(
      { ok: true, postDrafts },
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
