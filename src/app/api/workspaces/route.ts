import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        createdAt: true,
        settings: {
          select: {
            timezone: true,
            postingTargets: true,
          },
        },
      },
    });

    const ids = rows.map((w) => w.id);
    const chunkCounts = await prisma.primaryChunk.groupBy({
      by: ["workspaceId"],
      where: { workspaceId: { in: ids }, isActive: true },
      _count: { _all: true },
    });
    const chunkCountByWorkspaceId = new Map(chunkCounts.map((r) => [r.workspaceId, r._count._all]));

    const summaryCounts = await prisma.knowledgeSource.groupBy({
      by: ["workspaceId"],
      where: { workspaceId: { in: ids }, key: "job_hunting_summary" },
      _count: { _all: true },
    });
    const hasSummaryByWorkspaceId = new Map(summaryCounts.map((r) => [r.workspaceId, r._count._all > 0]));

    const workspaces = rows.map((w) => {
      const timezone = String(w.settings?.timezone ?? "").trim();
      const rawTargets = w.settings?.postingTargets;
      const postingTargets = Array.isArray(rawTargets)
        ? rawTargets.filter((p): p is "X" | "THREADS" => p === "X" || p === "THREADS")
        : [];
      return {
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        timezone,
        postingTargets,
        primaryChunkCount: Number(chunkCountByWorkspaceId.get(w.id) ?? 0),
        hasKnowledgeSummary: Boolean(hasSummaryByWorkspaceId.get(w.id) ?? false),
      };
    });

    return NextResponse.json({ ok: true, workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
