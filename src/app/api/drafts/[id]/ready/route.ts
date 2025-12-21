import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findUnique({
        where: { id },
        select: { id: true, formatted: true, status: true },
      });

      if (!draft) return null;

      const formatted = (draft.formatted ?? {}) as any;
      const hasAnyFormatted =
        typeof formatted === "object" && formatted !== null && Object.keys(formatted).length > 0;

      if (!hasAnyFormatted) {
        return { error: "内容が保存されていません（先に保存してください）" } as const;
      }

      const updatedDraft = await tx.draft.update({
        where: { id },
        data: {
          status: "READY_TO_APPROVE",
        },
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
            select: {
              id: true,
              approvedBy: true,
              note: true,
              createdAt: true,
            },
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
