import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PolicyBody = {
  schedulingPolicy?: unknown;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: id },
      select: { workspaceId: true, timezone: true, schedulingPolicy: true, updatedAt: true },
    });

    if (!settings) {
      return NextResponse.json({ ok: false, error: "workspace settings not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id?: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as PolicyBody;

    if (body.schedulingPolicy === undefined) {
      return NextResponse.json(
        { ok: false, error: "schedulingPolicy is required" },
        { status: 400 },
      );
    }

    const settings = await prisma.workspaceSettings.upsert({
      where: { workspaceId: id },
      create: {
        workspaceId: id,
        timezone: "Asia/Tokyo",
        postingTargets: [],
        schedulingPolicy: body.schedulingPolicy as any,
      },
      update: {
        schedulingPolicy: body.schedulingPolicy as any,
      },
      select: { workspaceId: true, timezone: true, schedulingPolicy: true, updatedAt: true },
    });

    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
