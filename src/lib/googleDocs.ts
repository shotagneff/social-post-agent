import { google } from "googleapis";

function getServiceAccountJson() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!b64) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is missing");
  }
  const jsonText = Buffer.from(String(b64), "base64").toString("utf8");
  try {
    return JSON.parse(jsonText) as {
      client_email: string;
      private_key: string;
    };
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON");
  }
}

export function getGoogleClients() {
  const sa = getServiceAccountJson();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
  });

  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });
  return { auth, drive, docs };
}

export async function listGoogleDocsInFolder(args: { folderId: string }) {
  const { drive } = getGoogleClients();
  const folderId = String(args.folderId ?? "").trim();
  if (!folderId) throw new Error("folderId is required");

  const files: Array<{ id: string; name: string; webViewLink: string | null; modifiedTime: string | null }> = [];

  let pageToken: string | undefined = undefined;
  for (let i = 0; i < 50; i++) {
    const res: any = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
      fields: "nextPageToken, files(id,name,webViewLink,modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const list = Array.isArray(res.data.files) ? res.data.files : [];
    for (const f of list) {
      const id = String(f.id ?? "").trim();
      if (!id) continue;
      files.push({
        id,
        name: String(f.name ?? "").trim(),
        webViewLink: f.webViewLink ? String(f.webViewLink) : null,
        modifiedTime: f.modifiedTime ? String(f.modifiedTime) : null,
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return files;
}

export async function getGoogleDocText(args: { docId: string }) {
  const { docs, drive } = getGoogleClients();
  const docId = String(args.docId ?? "").trim();
  if (!docId) throw new Error("docId is required");

  const doc = await docs.documents.get({ documentId: docId });
  const body = doc.data.body;
  const content = Array.isArray(body?.content) ? body!.content! : [];

  const out: string[] = [];

  const pushText = (t: unknown) => {
    if (typeof t !== "string") return;
    if (!t) return;
    out.push(t);
  };

  const walkStructuralElements = (elements: any[]) => {
    for (const el of elements) {
      const p = el?.paragraph;
      if (p) {
        const pe = Array.isArray(p?.elements) ? p.elements : [];
        for (const e of pe) {
          pushText(e?.textRun?.content);
        }
        continue;
      }

      const toc = el?.tableOfContents;
      if (toc) {
        const te = Array.isArray(toc?.content) ? toc.content : [];
        walkStructuralElements(te);
        continue;
      }

      const table = el?.table;
      if (table) {
        const rows = Array.isArray(table?.tableRows) ? table.tableRows : [];
        for (const r of rows) {
          const cells = Array.isArray(r?.tableCells) ? r.tableCells : [];
          for (const c of cells) {
            const ce = Array.isArray(c?.content) ? c.content : [];
            walkStructuralElements(ce);
          }
        }
        continue;
      }
    }
  };

  walkStructuralElements(content as any[]);

  const extracted = out.join("");
  if (extracted.trim().length >= 20) return extracted;

  // Fallback: export as plain text via Drive API (often more complete for tables/complex docs)
  try {
    // Prefer text response to avoid runtime-specific binary handling issues.
    try {
      const resText = await drive.files.export(
        { fileId: docId, mimeType: "text/plain" },
        { responseType: "text" },
      );
      const asText = resText.data as any;
      if (typeof asText === "string" && asText.trim().length > 0) return asText;
    } catch {
      // fallthrough
    }

    const res = await drive.files.export(
      { fileId: docId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    const data: any = res.data as any;
    if (typeof data === "string") return data || extracted;

    let bytes: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (data?.buffer && ArrayBuffer.isView(data.buffer)) {
      // rare: nested views
      bytes = new Uint8Array(data.buffer);
    }

    if (!bytes) return extracted;
    const exported = new TextDecoder("utf-8").decode(bytes);
    return exported || extracted;
  } catch {
    return extracted;
  }
}

export async function exportGoogleDocPlainTextDebug(args: { docId: string }) {
  const { drive } = getGoogleClients();
  const docId = String(args.docId ?? "").trim();
  if (!docId) throw new Error("docId is required");

  const decode = (data: any) => {
    if (typeof data === "string") {
      return { kind: "string" as const, text: data, bytes: null as number[] | null };
    }

    let bytes: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes) return { kind: "unknown" as const, text: "", bytes: null as number[] | null };

    const text = new TextDecoder("utf-8").decode(bytes);
    const head = Array.from(bytes.slice(0, 48));
    return { kind: "bytes" as const, text, bytes: head };
  };

  let textResponse: { ok: boolean; kind?: string; chars?: number; preview?: string } = { ok: false };
  try {
    const r = await drive.files.export(
      { fileId: docId, mimeType: "text/plain" },
      { responseType: "text" },
    );
    const t = decode(r.data);
    textResponse = {
      ok: true,
      kind: t.kind,
      chars: t.text.length,
      preview: t.text.slice(0, 200),
    };
  } catch {
    textResponse = { ok: false };
  }

  let arrayBufferResponse: {
    ok: boolean;
    kind?: string;
    chars?: number;
    preview?: string;
    headBytes?: number[] | null;
  } = { ok: false };
  try {
    const r = await drive.files.export(
      { fileId: docId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    const t = decode(r.data);
    arrayBufferResponse = {
      ok: true,
      kind: t.kind,
      chars: t.text.length,
      preview: t.text.slice(0, 200),
      headBytes: t.bytes,
    };
  } catch {
    arrayBufferResponse = { ok: false };
  }

  return {
    docId,
    textResponse,
    arrayBufferResponse,
  };
}

export function splitDocIntoChunksByChunkId(rawText: string) {
  const text = String(rawText ?? "");
  const re = /\n?\s*■\s*チャンクID\s*[:：]\s*([^\n]+)\n?/g;

  const matches: Array<{ index: number; id: string }> = [];
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    matches.push({ index: m.index, id: String(m[1] ?? "").trim() });
  }

  if (matches.length === 0) {
    const fallback = text
      .split(/\n\s*={3,}\s*\n|\n\s*-{3,}\s*\n|\n\s*―{3,}\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    return fallback.map((body, i) => ({ displayId: null as string | null, body, index: i }));
  }

  const chunks: Array<{ displayId: string | null; body: string; index: number }> = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const part = text.slice(start, end).trim();
    if (!part) continue;
    chunks.push({ displayId: matches[i]!.id || null, body: part, index: i });
  }

  return chunks;
}
