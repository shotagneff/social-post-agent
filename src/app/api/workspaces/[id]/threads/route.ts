import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: id },
      select: {
        workspaceId: true,
        threadsAccessToken: true,
        threadsUserId: true,
        threadsTokenExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      return NextResponse.json({ ok: false, error: "workspace settings not found" }, { status: 404 });
    }

    const connected = Boolean(settings.threadsAccessToken && settings.threadsUserId);

    return NextResponse.json({
      ok: true,
      connected,
      threads: {
        userId: settings.threadsUserId,
        tokenExpiresAt: settings.threadsTokenExpiresAt,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const updated = await prisma.workspaceSettings.updateMany({
      where: { workspaceId: id },
      data: {
        threadsAccessToken: null,
        threadsUserId: null,
        threadsTokenExpiresAt: null,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ ok: false, error: "workspace settings not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
