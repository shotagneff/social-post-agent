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
      };
    });

    return NextResponse.json({ ok: true, workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
