import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const schedules = await prisma.schedule.findMany({
      orderBy: { scheduledAt: "asc" },
      take: 50,
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
