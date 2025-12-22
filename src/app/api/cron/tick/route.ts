import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToThreadsText } from "@/lib/connectors/threads";

export const runtime = "nodejs";

const prismaAny = prisma as any;

function requireCronSecret(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const xCronSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const url = new URL(req.url);
  const query = url.searchParams.get("secret") ?? "";

  if (xCronSecret !== secret && bearer !== secret && query !== secret) {
    throw new Error("Unauthorized");
  }
}

type TickResult = {
  scheduleId: string;
  draftId: string | null;
  postDraftId: string | null;
  status: "posted" | "failed" | "skipped";
  errorText?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processOneSchedule(scheduleId: string) {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const claimed = await prismaAny.$transaction(async (tx: any) => {
        const txAny = tx as any;
        const updated = await txAny.schedule.updateMany({
          where: { id: scheduleId, status: "waiting" },
          data: { status: "posting" },
        });

        if (updated.count === 0) return null;

        const schedule = await txAny.schedule.findUnique({
          where: { id: scheduleId },
          select: {
            id: true,
            draftId: true,
            postDraftId: true,
            platform: true,
            status: true,
            postDraft: {
              select: {
                id: true,
                workspaceId: true,
                body: true,
              },
            },
            draft: {
              select: {
                id: true,
                workspaceId: true,
                formatted: true,
                variants: true,
              },
            },
          },
        });

        return schedule;
      });

      if (!claimed) {
        return { status: "skipped" as const };
      }

      if (!claimed.id) {
        return {
          status: "failed" as const,
          draftId: null,
          postDraftId: null,
          errorText: "schedule not found",
        };
      }

      const platform = claimed.platform;

      const textFromPostDraft = claimed.postDraft?.body ? String(claimed.postDraft.body) : "";
      const textFromDraft = (() => {
        const formatted = (claimed.draft?.formatted ?? {}) as any;
        const fromFormatted = String(formatted?.[platform]?.A ?? "");
        if (fromFormatted.trim()) return fromFormatted;
        const variants = (claimed.draft?.variants ?? {}) as any;
        const fromVariants = String(variants?.A?.body ?? "");
        return fromVariants;
      })();
      const text = (textFromPostDraft || textFromDraft || "").trim();

      if (!text) {
        throw new Error("post text is empty");
      }

      const workspaceId = String((claimed.postDraft as any)?.workspaceId ?? (claimed.draft as any)?.workspaceId ?? "").trim();
      const threadsCreds =
        platform === "THREADS" && workspaceId
          ? await prismaAny.workspaceSettings.findUnique({
              where: { workspaceId },
              select: { threadsAccessToken: true, threadsUserId: true, threadsTokenExpiresAt: true },
            })
          : null;

      if (
        platform === "THREADS" &&
        (!workspaceId || !threadsCreds?.threadsAccessToken || !threadsCreds?.threadsUserId)
      ) {
        return {
          status: "failed" as const,
          draftId: claimed.draftId ?? null,
          postDraftId: claimed.postDraftId ?? null,
          errorText: "Threads連携が未設定です。/threads/connect で投稿先を選んで連携してください。",
        };
      }

      const published =
        platform === "THREADS"
          ? await publishToThreadsText({
              text,
              accessToken: String(threadsCreds?.threadsAccessToken ?? ""),
              userId: String(threadsCreds?.threadsUserId ?? ""),
            })
          : ({
              ok: false,
              error: "Xの投稿コネクタは未実装です（Threadsは設定すれば投稿できます）。",
              retryable: false,
            } as const);

      if (!published.ok) {
        const message = published.error;
        if (published.retryable) {
          await prismaAny.schedule.updateMany({
            where: { id: scheduleId, status: "posting" },
            data: { status: "waiting", errorText: message },
          });
        } else {
          await prismaAny.schedule.updateMany({
            where: { id: scheduleId },
            data: { status: "failed", errorText: message },
          });
        }

        return {
          status: "failed" as const,
          draftId: claimed.draftId ?? null,
          postDraftId: claimed.postDraftId ?? null,
          errorText: message,
        };
      }

      const finalized = await prismaAny.$transaction(async (tx: any) => {
        const txAny = tx as any;
        await txAny.publishedPost.upsert({
          where: { scheduleId: scheduleId },
          create: {
            scheduleId: scheduleId,
            platform,
            externalPostId: published.externalPostId || null,
            raw: published.raw ?? {},
          },
          update: {
            platform,
            externalPostId: published.externalPostId || null,
            raw: published.raw ?? {},
          },
        });

        await txAny.schedule.update({
          where: { id: scheduleId },
          data: {
            status: "posted",
            errorText: null,
          },
        });

        if (claimed.draftId) {
          const remaining = await txAny.schedule.count({
            where: {
              draftId: claimed.draftId,
              status: { in: ["waiting", "posting"] },
            },
          });

          await txAny.draft.update({
            where: { id: claimed.draftId },
            data: {
              status: remaining === 0 ? "POSTED" : "POSTING",
            },
          });
        }

        if (claimed.postDraftId) {
          const remaining = await txAny.schedule.count({
            where: {
              postDraftId: claimed.postDraftId,
              status: { in: ["waiting", "posting"] },
            },
          });

          await txAny.postDraft.update({
            where: { id: claimed.postDraftId },
            data: {
              status: remaining === 0 ? "POSTED" : "POSTING",
            },
          });
        }

        return {
          status: "posted" as const,
          draftId: claimed.draftId,
          postDraftId: claimed.postDraftId,
        };
      });

      return finalized;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      lastError = message;
      const isTransientDisconnect = message.includes("Server has closed the connection");

      if (isTransientDisconnect && attempt < 3) {
        await sleep(200 * attempt);
        continue;
      }

      // Mark failed (or revert to waiting for transient disconnect), but don't throw to allow processing other schedules.
      const schedule = await prismaAny.schedule.findUnique({
        where: { id: scheduleId },
        select: { id: true, draftId: true, postDraftId: true },
      });

      if (isTransientDisconnect) {
        // Try to avoid leaving schedules stuck in "posting" due to transient DB issues.
        await prismaAny.schedule.updateMany({
          where: { id: scheduleId, status: "posting" },
          data: { status: "waiting", errorText: message },
        });
      } else {
        await prismaAny.schedule.updateMany({
          where: { id: scheduleId },
          data: { status: "failed", errorText: message },
        });
      }

      return {
        status: "failed" as const,
        draftId: schedule?.draftId ?? null,
        postDraftId: schedule?.postDraftId ?? null,
        errorText: message,
      };
    }
  }

  return {
    status: "failed" as const,
    draftId: null,
    postDraftId: null,
    errorText: lastError || "Unknown error",
  };
}

export async function GET(req: Request) {
  try {
    requireCronSecret(req);

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.max(1, Math.min(50, Number(limitRaw ?? "20") || 20));

    const now = new Date();

    const due = await prismaAny.schedule.findMany({
      where: {
        status: "waiting",
        OR: [{ isConfirmed: true }, { draftId: { not: null } }],
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      select: { id: true, draftId: true, postDraftId: true },
    });

    const results: TickResult[] = [];

    for (const s of due) {
      const r = await processOneSchedule(s.id);
      if (r.status === "skipped") {
        results.push({
          scheduleId: s.id,
          draftId: s.draftId,
          postDraftId: s.postDraftId,
          status: "skipped",
        });
      } else if (r.status === "posted") {
        results.push({
          scheduleId: s.id,
          draftId: r.draftId,
          postDraftId: r.postDraftId,
          status: "posted",
        });
      } else {
        results.push({
          scheduleId: s.id,
          draftId: r.draftId,
          postDraftId: r.postDraftId,
          status: "failed",
          errorText: r.errorText,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      now: now.toISOString(),
      found: due.length,
      processed: results.filter((r) => r.status === "posted").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: Request) {
  // Alias to GET for convenience.
  return GET(req);
}
