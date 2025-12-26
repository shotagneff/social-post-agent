import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exportGoogleDocPlainTextDebug,
  getGoogleDocText,
  listGoogleDocsInFolder,
  splitDocIntoChunksByChunkId,
} from "@/lib/googleDocs";

export const runtime = "nodejs";

type ImportBody = {
  knowledgeDocId?: string;
  currentFolderId?: string;
  alumniFolderId?: string;
  dryRun?: boolean;
};

function chunkKey(docId: string, idx: number) {
  return `gdoc:${docId}#chunk:${String(idx).padStart(2, "0")}`;
}

async function upsertKnowledgeSummary(args: {
  workspaceId: string;
  docId: string;
  sourceUrl: string;
  body: string;
}) {
  return prisma.knowledgeSource.upsert({
    where: { workspaceId_key: { workspaceId: args.workspaceId, key: "job_hunting_summary" } },
    create: {
      workspaceId: args.workspaceId,
      key: "job_hunting_summary",
      title: "知識まとめ",
      body: args.body,
      sourceDocId: args.docId,
      sourceUrl: args.sourceUrl,
    },
    update: {
      title: "知識まとめ",
      body: args.body,
      sourceDocId: args.docId,
      sourceUrl: args.sourceUrl,
    },
    select: { id: true, updatedAt: true },
  });
}

async function upsertPrimaryChunks(args: {
  workspaceId: string;
  folderId: string;
  kind: "current" | "alumni";
  docs: Array<{ id: string; name: string; webViewLink: string | null }>;
  dryRun: boolean;
}) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const d of args.docs) {
    const docId = d.id;
    const sourceUrl = d.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`;

    const text = await getGoogleDocText({ docId });
    const chunks = splitDocIntoChunksByChunkId(text);

    for (const ch of chunks) {
      const key = chunkKey(docId, ch.index);
      const title = ch.displayId ? `チャンク ${ch.displayId}` : (d.name ? `チャンク ${d.name}` : null);
      const body = String(ch.body ?? "").trim();
      if (!body) {
        skipped++;
        continue;
      }

      if (args.dryRun) {
        skipped++;
        continue;
      }

      const existing = await prisma.primaryChunk.findUnique({
        where: { workspaceId_chunkKey: { workspaceId: args.workspaceId, chunkKey: key } },
        select: { id: true, body: true },
      });

      const isUpdate = Boolean(existing);

      await prisma.primaryChunk.upsert({
        where: { workspaceId_chunkKey: { workspaceId: args.workspaceId, chunkKey: key } },
        create: {
          workspaceId: args.workspaceId,
          kind: args.kind,
          chunkKey: key,
          chunkIndex: ch.index,
          title,
          body,
          tags: [],
          sourceDocId: docId,
          sourceUrl,
          sourceFolderId: args.folderId,
          isActive: true,
        },
        update: {
          kind: args.kind,
          chunkIndex: ch.index,
          title,
          body,
          sourceDocId: docId,
          sourceUrl,
          sourceFolderId: args.folderId,
          isActive: true,
        },
        select: { id: true },
      });

      if (isUpdate) updated++;
      else created++;
    }
  }

  return { created, updated, skipped };
}

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const url = new URL(req.url);
    const debugParam = url.searchParams.get("debug");
    const debug = debugParam === "1";
    const debugFetch = debugParam === "2";
    const debugExport = debugParam === "3";

    const rawBody = await req
      .clone()
      .text()
      .catch(() => "");
    const body = (() => {
      if (!rawBody) return {} as ImportBody;
      try {
        return JSON.parse(rawBody) as ImportBody;
      } catch {
        return {} as ImportBody;
      }
    })();

    const parseBool = (v: unknown) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v === 1;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
      }
      return false;
    };

    const knowledgeDocId = String(body.knowledgeDocId ?? "1ljrX3XpTY6SjKQdyB_4dbaY8tBZ4TSBY7qdjUFebzGc").trim();
    const currentFolderId = String(body.currentFolderId ?? "1Ywfs6XbCdcI5lJ6GSvWEEZk7XSTlclOo").trim();
    const alumniFolderId = String(body.alumniFolderId ?? "1RBpcaj_yKQZys7MuASAhSZepM13MSNQh").trim();
    const dryRun = parseBool(body.dryRun);

    if (debug) {
      return NextResponse.json({
        ok: true,
        debug: true,
        workspaceId: id,
        rawBody,
        parsedBody: body,
        computed: { dryRun },
      });
    }

    if (debugExport) {
      if (!knowledgeDocId) {
        return NextResponse.json({ ok: false, error: "knowledgeDocId is required" }, { status: 400 });
      }

      const diag = await exportGoogleDocPlainTextDebug({ docId: knowledgeDocId });
      return NextResponse.json({
        ok: true,
        debug: 3,
        dryRun,
        workspaceId: id,
        knowledge: {
          docId: knowledgeDocId,
        },
        export: diag,
      });
    }

    if (debugFetch) {
      if (!knowledgeDocId || !currentFolderId || !alumniFolderId) {
        return NextResponse.json(
          { ok: false, error: "knowledgeDocId/currentFolderId/alumniFolderId are required" },
          { status: 400 },
        );
      }

      const [summaryText, currentDocs, alumniDocs] = await Promise.all([
        getGoogleDocText({ docId: knowledgeDocId }),
        listGoogleDocsInFolder({ folderId: currentFolderId }),
        listGoogleDocsInFolder({ folderId: alumniFolderId }),
      ]);

      const summary = String(summaryText ?? "");
      return NextResponse.json({
        ok: true,
        debug: 2,
        dryRun,
        workspaceId: id,
        knowledge: {
          docId: knowledgeDocId,
          chars: summary.length,
          preview: summary.slice(0, 400),
        },
        primary: {
          current: { folderId: currentFolderId, docs: currentDocs.length },
          alumni: { folderId: alumniFolderId, docs: alumniDocs.length },
        },
      });
    }

    if (!knowledgeDocId || !currentFolderId || !alumniFolderId) {
      return NextResponse.json(
        { ok: false, error: "knowledgeDocId/currentFolderId/alumniFolderId are required" },
        { status: 400 },
      );
    }

    const [summaryText, currentDocs, alumniDocs] = await Promise.all([
      getGoogleDocText({ docId: knowledgeDocId }),
      listGoogleDocsInFolder({ folderId: currentFolderId }),
      listGoogleDocsInFolder({ folderId: alumniFolderId }),
    ]);

    const knowledgeSourceUrl = `https://docs.google.com/document/d/${knowledgeDocId}/edit`;

    const summaryRes = dryRun
      ? { id: null as string | null, updatedAt: null as Date | null }
      : await upsertKnowledgeSummary({
          workspaceId: id,
          docId: knowledgeDocId,
          sourceUrl: knowledgeSourceUrl,
          body: summaryText,
        });

    const currentRes = await upsertPrimaryChunks({
      workspaceId: id,
      folderId: currentFolderId,
      kind: "current",
      docs: currentDocs.map((d) => ({ id: d.id, name: d.name, webViewLink: d.webViewLink })),
      dryRun,
    });

    const alumniRes = await upsertPrimaryChunks({
      workspaceId: id,
      folderId: alumniFolderId,
      kind: "alumni",
      docs: alumniDocs.map((d) => ({ id: d.id, name: d.name, webViewLink: d.webViewLink })),
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      workspaceId: id,
      knowledge: {
        docId: knowledgeDocId,
        sourceUrl: knowledgeSourceUrl,
        saved: !dryRun,
        id: summaryRes.id,
        updatedAt: summaryRes.updatedAt,
        chars: String(summaryText ?? "").length,
      },
      primary: {
        current: {
          folderId: currentFolderId,
          docs: currentDocs.length,
          ...currentRes,
        },
        alumni: {
          folderId: alumniFolderId,
          docs: alumniDocs.length,
          ...alumniRes,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
