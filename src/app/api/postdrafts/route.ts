import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientDbError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Server has closed the connection|ECONNRESET|Connection terminated unexpectedly|terminating connection/i.test(msg);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = String(searchParams.get("workspaceId") ?? "").trim();
    const take = Math.max(1, Math.min(200, Number(searchParams.get("take") ?? 50) || 50));

    let postDrafts: any[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        postDrafts = await prismaAny.postDraft.findMany({
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
        break;
      } catch (e) {
        if (attempt < 2 && isTransientDbError(e)) {
          await sleep(200 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }

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
