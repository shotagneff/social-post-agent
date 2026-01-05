import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = String(url.searchParams.get("workspaceId") ?? "").trim();

    const now = new Date();
    const schedules = await prisma.schedule.findMany({
      where: {
        status: { in: ["waiting", "posting", "failed"] },
        OR: [{ isConfirmed: true }, { draftId: { not: null } }],
        // Keep due items (past scheduledAt) visible; hide only history.
        scheduledAt: { gte: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7) },
        ...(workspaceId
          ? {
              OR: [
                { draft: { workspaceId } },
                { postDraft: { workspaceId } },
              ],
            }
          : {}),
      },
      orderBy: { scheduledAt: "asc" },
      take: 200,
      select: {
        id: true,
        draftId: true,
        postDraftId: true,
        platform: true,
        scheduledAt: true,
        status: true,
        isConfirmed: true,
        errorText: true,
        createdAt: true,
        updatedAt: true,
        published: {
          select: {
            id: true,
            externalPostId: true,
            postedAt: true,
          },
        },
        draft: {
          select: {
            id: true,
            theme: true,
            status: true,
            workspaceId: true,
          },
        },
        postDraft: {
          select: {
            id: true,
            workspaceId: true,
            platform: true,
            status: true,
            body: true,
            tempScheduledAt: true,
            confirmedAt: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
