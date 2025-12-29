import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type Body = {
  postingTargets?: Platform[];
};

export async function PUT(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    const workspaceId = String(id ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const raw = Array.isArray(body.postingTargets) ? body.postingTargets : [];
    const postingTargets = raw.filter((p): p is Platform => p === "X" || p === "THREADS");

    if (postingTargets.length === 0) {
      return NextResponse.json({ ok: false, error: "postingTargets is required" }, { status: 400 });
    }

    const updated = await prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Tokyo",
        postingTargets,
        schedulingPolicy: {},
      },
      update: {
        postingTargets,
      },
      select: { workspaceId: true, postingTargets: true },
    });

    return NextResponse.json({ ok: true, workspaceId: updated.workspaceId, postingTargets: updated.postingTargets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
