import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const prismaAny = prisma as any;

type Platform = "X" | "THREADS";

type Body = {
  workspaceId?: string;
  platform?: Platform;
  count?: number;
  theme?: string;
  useOpenAI?: boolean;
  audience?: unknown;
};

function compactText(x: unknown, maxLen: number) {
  const t = String(x ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return t.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}

function extractKeywords(args: { theme: string; audience: unknown }) {
  const collectValues = (v: unknown, out: string[]) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push(s);
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) collectValues(x, out);
      return;
    }
    if (typeof v === "object") {
      for (const x of Object.values(v as any)) collectValues(x, out);
    }
  };

  const audienceVals: string[] = [];
  collectValues(args.audience ?? {}, audienceVals);

  const src = [String(args.theme ?? "").trim(), ...audienceVals]
    .join("\n")
    .replace(/[\[\]{}()<>"'`]/g, " ")
    .replace(/[\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const raw = src
    .split(/\s|、|。|・|,|\//g)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: string[] = [];
  const stop = new Set([
    "who",
    "pain",
    "desired",
    "nogo",
    "no-go",
    "ng",
    "audience",
  ]);
  for (const w of raw) {
    if (w.length < 2) continue;
    if (w.length > 24) continue;
    if (/^(https?:\/\/|@)/i.test(w)) continue;
    if ((w.match(/\?/g) ?? []).length / Math.max(1, w.length) >= 0.3) continue;
    if (w.includes("\uFFFD")) continue;
    if (stop.has(w.toLowerCase())) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

async function retrieveKnowledgeContext(args: {
  workspaceId: string;
  theme: string;
  audience: unknown;
}) {
  const keywords = extractKeywords({ theme: args.theme, audience: args.audience });

  const knowledge = await prisma.knowledgeSource.findUnique({
    where: { workspaceId_key: { workspaceId: args.workspaceId, key: "job_hunting_summary" } },
    select: { body: true, sourceUrl: true, sourceDocId: true, updatedAt: true },
  });

  const or = keywords.map((k) => ({ body: { contains: k, mode: "insensitive" as const } }));
  const where = {
    workspaceId: args.workspaceId,
    isActive: true,
    ...(or.length ? { OR: or } : {}),
  } as any;

  const select = {
    kind: true,
    chunkKey: true,
    title: true,
    body: true,
    sourceUrl: true,
    sourceDocId: true,
    updatedAt: true,
  };

  let chunks = await prisma.primaryChunk.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 30,
    select,
  });

  // Fallback: if keyword filtering yields nothing, use recent active chunks so RAG can still work.
  if (chunks.length === 0 && or.length > 0) {
    chunks = await prisma.primaryChunk.findMany({
      where: { workspaceId: args.workspaceId, isActive: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 30,
      select,
    });
  }

  const parseChunkId = (chunkKey: string) => {
    const m = String(chunkKey ?? "").match(/#chunk:([^#\s]+)/i);
    return m?.[1] ? String(m[1]).trim() : "";
  };

  const kwLower = keywords.map((k) => String(k ?? "").toLowerCase()).filter(Boolean);
  const scoreChunk = (c: any) => {
    const bodyLower = String(c?.body ?? "").toLowerCase();
    if (!bodyLower) return 0;
    let score = 0;
    for (const k of kwLower) {
      if (!k) continue;
      // count occurrences roughly; cap to avoid over-weighting repetitive chunks
      const hits = bodyLower.split(k).length - 1;
      score += Math.min(3, Math.max(0, hits));
    }
    return score;
  };

  const scored = chunks
    .map((c) => ({ c, score: scoreChunk(c), chunkId: parseChunkId(c.chunkKey) }))
    .sort((a, b) => b.score - a.score);

  const pickDiverse = (want: number) => {
    const out: any[] = [];
    const usedChunkIds = new Set<string>();
    const usedKinds = new Set<string>();

    const tryAdd = (item: { c: any; chunkId: string }) => {
      if (out.length >= want) return;
      out.push(item.c);
      if (item.chunkId) usedChunkIds.add(item.chunkId);
      usedKinds.add(String(item.c.kind ?? ""));
    };

    // Pass 1: prefer high score, avoid repeating chunkId.
    for (const item of scored) {
      if (out.length >= want) break;
      if (item.chunkId && usedChunkIds.has(item.chunkId)) continue;
      tryAdd(item);
    }

    // Pass 2: if still not enough, allow repeats but keep score order.
    for (const item of scored) {
      if (out.length >= want) break;
      if (out.includes(item.c)) continue;
      tryAdd(item);
    }

    // If we have both kinds available but picked only one kind, try to swap in one of the missing kind.
    const allKinds = new Set(chunks.map((c: any) => String(c.kind ?? "")).filter(Boolean));
    if (allKinds.size >= 2 && usedKinds.size === 1 && out.length > 0) {
      const missingKind = Array.from(allKinds).find((k) => !usedKinds.has(k));
      if (missingKind) {
        const candidate = scored.find((s) => String(s.c.kind ?? "") === missingKind);
        if (candidate) {
          out[out.length - 1] = candidate.c;
        }
      }
    }

    return out.slice(0, want);
  };

  const picked = pickDiverse(4);

  return {
    keywords,
    knowledgeSummary: compactText(knowledge?.body ?? "", 1800),
    knowledgeMeta: knowledge
      ? {
          sourceUrl: knowledge.sourceUrl ?? null,
          sourceDocId: knowledge.sourceDocId ?? null,
          updatedAt: knowledge.updatedAt,
        }
      : null,
    primaryChunks: picked.map((c) => ({
      kind: c.kind,
      chunkKey: c.chunkKey,
      title: c.title ?? null,
      body: compactText(c.body, 5000),
      bodyFull: c.body,
      quoteCandidates: buildQuoteCandidates(c.body),
      sourceUrl: c.sourceUrl ?? null,
      sourceDocId: c.sourceDocId ?? null,
      updatedAt: c.updatedAt,
    })),
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return "";
}

function buildQuoteCandidates(body: string) {
  const src = String(body ?? "").replace(/\r\n/g, "\n");
  const lines = src
    .split(/\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const extractQuotedSection = (marker: string) => {
    const idx = lines.findIndex((l) => l.replace(/[\s　]+/g, "").includes(marker));
    if (idx < 0) return [] as string[];
    const out: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = String(lines[i] ?? "").trim();
      if (!l) continue;
      // stop when another section likely starts
      if (/^[■●◆▼▶◇□]+/.test(l)) break;
      if (/^(チャンクID|想定検索質問|検索質問|目次|参考|補足)[:：]?/i.test(l)) break;
      if (/^引用候補/.test(l)) continue;
      const cleaned = l.replace(/^(?:-|・|\*|•)\s*/g, "").trim();
      if (!cleaned) continue;
      out.push(cleaned);
      if (out.length >= 6) break;
    }
    return out;
  };

  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Heuristic: if a line is a question, the next line often contains the answer/explanation.
    if (/\?$/.test(line) && i + 1 < lines.length) {
      const next = lines[i + 1]!;
      parts.push(next);
    }
    parts.push(line);
  }

  const nonQuestion: string[] = [];
  const question: string[] = [];

  const isAcceptableCandidate = (raw: string, opts?: { relaxEnd?: boolean }) => {
    const core = String(raw ?? "")
      .replace(/^[^：:]{1,20}[（(][^）)]+[）)]\s*[：:]/, "")
      .replace(/^[^：:]{1,20}\s*[：:]/, "")
      .trim();

    const looksLikeTranscriptNoise = (() => {
      const s = core;
      if (!s) return true;
      if (/^[•・]/.test(s)) return true;
      if (/(画面が固ま|聞こえ|聞こ。|音声|接続|途切|通信|ミュート)/.test(s)) return true;
      const unCount = (s.match(/うん/g) ?? []).length;
      const eeCount = (s.match(/えー/g) ?? []).length;
      const anoCount = (s.match(/あの/g) ?? []).length;
      if (unCount >= 3 || eeCount >= 2 || anoCount >= 2) return true;
      const punct = (s.match(/[。.!！?？]/g) ?? []).length;
      if (punct >= 6 && s.length <= 60) return true;
      return false;
    })();
    if (looksLikeTranscriptNoise) return null;

    const looksLikeHeader = (() => {
      const s = core;
      if (!s) return true;
      if (/^[■●◆▼▶◇□]+/.test(s)) return true;
      if (/^(チャンクID|想定検索質問|検索質問|目次|参考|補足)[:：]?/i.test(s)) return true;
      if (/^質問[】\]]/.test(s)) return true;
      if (s.includes("チャンクID")) return true;
      if (s.includes("想定検索質問")) return true;
      if (s.includes("想定される検索")) return true;
      if (s.includes("質問】")) return true;
      if (s.includes("対応フェーズ")) return true;
      if (s.includes("【対応フェーズ】")) return true;
      if (s.includes("【対応")) return true;
      if (/^(?:-|・|\*|•)\s*/.test(s) && s.length <= 40) return true;
      // List-like headings often contain middle dots.
      if (s.includes("・") && /(優先順位|フェーズ|チェック|対応)/.test(s)) return true;
      return false;
    })();
    if (looksLikeHeader) return null;

    // Reject fragments that look like they start mid-sentence (closing bracket/quote/punctuation).
    if (/^[）」』】\]、】【〕】」’”]/.test(core)) return null;
    if (/^[、。,.!！?？]/.test(core)) return null;
    // Reject fragments that look like they start mid-sentence with a connective.
    if (/^[てで]$/.test(core)) return null;
    if (/^[てで](?![ぁ-ゖァ-ヶー])/.test(core)) return null;
    // Reject fragments that look like they start mid-sentence with an embedded quote/parenthetical.
    if (/^と[（(]/.test(core)) return null;

    if (core.length < 12) return null;
    if (core.length > 60) return null;
    if (/\?$/.test(core) && core.length <= 18) return null;
    if (/^(はい|うん|ええ|大丈夫|OK|了解|問題ない|できます|可能です)[。！!]?$/i.test(core)) return null;
    if (/^(はい|うん|ええ|大丈夫|OK|了解|問題ない)/i.test(core) && core.length <= 16) return null;

    // Reject truncated fragments that end with an opening quote/bracket.
    if (/[「『（(【\[]$/.test(core)) return null;
    if (/、[「『（(【\[]$/.test(core)) return null;

    // Reject likely-truncated fragments that end with a comma or unfinished connective.
    if (/[、,]$/.test(core)) return null;
    if (/(という|ので|から|ため|として)[、,]?$/.test(core)) return null;

    // Reject likely-truncated fragments that end with a conditional without conclusion.
    // e.g. "講義に出席しなければ" (missing what happens next)
    if (/(?:し)?なければ$/.test(core)) return null;

    const relaxEnd = Boolean(opts?.relaxEnd);
    if (!relaxEnd) {
      // Reject likely-truncated fragments that end with a particle or possessive.
      if (/(?:の|が|を|に|へ|と|で|から|まで|より|や|か)$/.test(core)) return null;

      // Require the candidate to end in a sentence-final form (otherwise it is often a clipped fragment).
      const endsSentence = /[。．.!！?？]$/.test(core);
      const endsPredicate = /(です|ます|だった|だ|する|した|できる|しろ|せよ|やめろ)$/.test(core);
      if (!endsSentence && !endsPredicate) return null;
    }

    // Reject likely-unbalanced quote/bracket fragments (e.g., contains opening without closing).
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    const openClosePairs: Array<[RegExp, RegExp]> = [
      [/「/g, /」/g],
      [/『/g, /』/g],
      [/（/g, /）/g],
      [/\(/g, /\)/g],
      [/【/g, /】/g],
      [/\[/g, /\]/g],
    ];
    for (const [openRe, closeRe] of openClosePairs) {
      if (count(core, openRe) > count(core, closeRe)) return null;
    }

    const hasPredicate = /(です|ます|だった|だ|する|した|でき|不安|大事|重要|おすすめ|コツ|ポイント|方法|やり方|必要|まず)/.test(core);
    if (!hasPredicate) return null;

    const qCount = (core.match(/\?/g) ?? []).length;
    const repCount = (core.match(/\uFFFD/g) ?? []).length;
    const badRatio = (qCount + repCount) / Math.max(1, core.length);
    if (badRatio >= 0.2) return null;

    return core;
  };

  // If the doc author provided an explicit section for quoting, prioritize it.
  const explicit = extractQuotedSection("引用候補")
    .map((x) => isAcceptableCandidate(x, { relaxEnd: true }))
    .filter(Boolean) as string[];
  if (explicit.length >= 2) {
    // Keep original order; prefer up to 6.
    return Array.from(new Set(explicit)).slice(0, 6);
  }

  for (const p of parts) {
    const core = isAcceptableCandidate(p);
    if (!core) continue;
    const bucket = /\?$/.test(core) ? question : nonQuestion;
    if (!bucket.includes(core)) bucket.push(core);
    if (nonQuestion.length >= 6) break;
  }

  let out = [...nonQuestion, ...question].slice(0, 6);
  // If strict filtering is too harsh and leaves us with too few candidates,
  // run a relaxed pass that only loosens sentence-final constraints.
  if (out.length < 2) {
    const relaxed: string[] = [];
    for (const p of parts) {
      const core = isAcceptableCandidate(p, { relaxEnd: true });
      if (!core) continue;
      if (!relaxed.includes(core)) relaxed.push(core);
      if (relaxed.length >= 6) break;
    }
    if (relaxed.length >= 2) out = relaxed.slice(0, 6);
  }
  if (out.length >= 3) return out;

  const compact = src.replace(/[\s\u3000]+/g, " ").trim();
  for (let i = 0; i < compact.length && out.length < 6; i += 40) {
    const slice = compact.slice(i, i + 40).trim();
    const core = isAcceptableCandidate(slice);
    if (!core) continue;
    if (!out.includes(core)) out.push(core);
  }
  return out.slice(0, 6);
}

async function generatePostsWithOpenAI(args: {
  theme: string;
  themes: string[];
  perThemeCounts: number[];
  platform: Platform;
  count: number;
  personaProfile: unknown;
  narratorProfile: unknown;
  genreProfile: unknown;
  audience: unknown;
  sources: Array<{ platform: Platform; handle: string; weight: number | null; memo: string | null }>;
  knowledgeSummary?: string;
  primaryChunks?: Array<{
    kind: string;
    chunkKey: string;
    title: string | null;
    body: string;
    bodyFull?: string;
    quoteCandidates?: string[];
    sourceUrl: string | null;
  }>;
  enforceEvidence?: boolean;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const maxLen = args.platform === "X" ? 260 : 900;
  const enforceEvidence = args.enforceEvidence !== false;
  const sourceAccountsForPrompt = (Array.isArray(args.sources) ? args.sources : [])
    .filter((s) => String(s?.handle ?? "").trim())
    .map((s) => ({
      platform: s.platform,
      handle: String(s.handle).trim(),
      weight: typeof s.weight === "number" ? s.weight : null,
      memo: s.memo ? String(s.memo) : "",
    }))
    .sort((a, b) => (Number(b.weight ?? 0) || 0) - (Number(a.weight ?? 0) || 0))
    .slice(0, 20);
  const prompt = {
    language: "ja",
    platform: args.platform,
    count: args.count,
    maxLen,
    theme: args.theme,
    themes: args.themes,
    perThemeCounts: args.perThemeCounts,
    persona: args.personaProfile,
    narrator: args.narratorProfile,
    genre: args.genreProfile,
    audience: args.audience,
    sourceAccounts: sourceAccountsForPrompt,
    knowledge: {
      summary: String(args.knowledgeSummary ?? "").trim(),
      primaryChunks: Array.isArray(args.primaryChunks) ? args.primaryChunks : [],
    },
    output: {
      posts:
        enforceEvidence
          ? "{text: string, themeIndex: 0|1|2|3|4, sourcesUsed: {platform: 'X'|'THREADS', handle: string}[], evidenceChunkKey: string, evidenceQuoteIndex: number, styleApplied?: string}[] (length must equal count). evidenceChunkKey MUST be one of knowledge.primaryChunks[].chunkKey. evidenceQuoteIndex MUST be a valid index into the selected chunk's quoteCandidates, and that candidate MUST appear verbatim in text."
          : "{text: string, themeIndex: 0|1|2|3|4, sourcesUsed: {platform: 'X'|'THREADS', handle: string}[], styleApplied?: string}[] (length must equal count).",
    },
    rules: [
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      "Each post must be self-contained.",
      "First, interpret themes as 5 subtopics derived from the base theme.",
      "For each post, pick exactly one themeIndex (0..4) and write to that subtopic.",
      "You MUST generate exactly perThemeCounts[i] posts for each themeIndex i (0..4).",
      "Keep within maxLen characters; if close, prefer shorter.",
      "Avoid repeating the same hook across posts; vary angles.",
      "Do NOT include hashtags (e.g., '#就活').",
      "For each post, choose 1-2 sourceAccounts and set sourcesUsed accordingly.",
      "When selecting sourcesUsed, prefer higher weight accounts, but diversify across posts.",
      "You MUST apply the selected sources' memo as concrete writing directives (tone, structure, hook style, emoji usage, length preference, bullet usage, etc.).",
      "If a selected source has an empty memo, infer a generic but distinct style (e.g., '結論→理由→一言', '箇条書き中心', '短文テンポ').",
      "Treat narrator as the author profile (立場/性別/人物像/背景/価値観/制約) and keep it consistent across all posts.",
      "Do NOT explicitly state gender (e.g., '私は女性です'). If gender is provided, only let it subtly influence wording.",
      "Source memo is a style reference and MUST NOT override narrator constraints (e.g., no煽り, no根拠없는断定, etc.).",
      "Optimize for the provided audience (who/situation/pain/desired/no-go). Make the post feel written for that reader.",
      "Respect audience no-go. Avoid language, claims, or tone that violates it.",
      "If knowledge.summary is provided, use it as factual background to avoid generic or incorrect claims.",
      "If knowledge.primaryChunks is provided, use at least one chunk's content as concrete material. Prefer combining: 1 current + 1 alumni when available.",
      "CRITICAL: Avoid generic励まし投稿 only (e.g., '頑張ろう/一歩踏み出そう' だけ). Each post MUST include at least ONE concrete, specific detail taken from knowledge.summary or knowledge.primaryChunks (e.g., a named technique like 'モチベーショングラフ', a checklist item, a step-by-step procedure, an example pattern, a question template, a pitfall and its workaround).",
      "CRITICAL: The concrete detail must be explicit in the text (reader can point to it). If you cannot find a suitable detail, you MUST infer a concrete micro-action by paraphrasing the provided knowledge (not inventing unrelated advice).",
      ...(enforceEvidence
        ? [
            "CRITICAL: For EACH post, set evidenceChunkKey to the primary chunk you actually used. You MUST incorporate at least one specific detail from that chunk into the post text (paraphrase is OK).",
            "CRITICAL: For EACH post, set evidenceQuoteIndex to the index (0-based) of EXACTLY ONE string chosen from the selected chunk's quoteCandidates. You MUST copy that exact candidate into the post text verbatim.",
            "CRITICAL: Include EXACTLY ONE quoteCandidate per post. Do NOT include any other strings from knowledge.primaryChunks[].quoteCandidates besides the one at evidenceQuoteIndex.",
            "CRITICAL: Avoid reusing the same evidenceChunkKey across multiple posts in the same batch when possible. Prefer spreading across different primary chunks.",
            "CRITICAL: Avoid reusing the same (evidenceChunkKey, evidenceQuoteIndex) across multiple posts in the same batch when possible. Prefer diversity.",
          ]
        : []),
      "Do NOT paste long quotes. Paraphrase and generalize while keeping the essence.",
      "Do NOT copy phrases, unique catchphrases, or structure verbatim from sources; only use them as inspiration for tone/angles/structure.",
      "Avoid mentioning the source account names in the post body.",
      "Optionally set styleApplied to a short Japanese note describing what style you applied (for debugging), without revealing the account name.",
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate Japanese social media post drafts. Output only valid JSON with the requested keys.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new Error("OpenAI returned non-JSON content");
  }

  const parsed = JSON.parse(jsonText) as any;
  const posts = Array.isArray(parsed?.posts) ? (parsed.posts as any[]) : [];

  const chunkList = Array.isArray(args.primaryChunks) ? args.primaryChunks : [];
  const allowedEvidence = new Set(chunkList.map((c) => String(c?.chunkKey ?? "").trim()).filter(Boolean));
  const chunkBodyByKey = new Map(
    chunkList.map((c) => [
      String(c?.chunkKey ?? "").trim(),
      // Validate evidenceQuote against the FULL body when available to avoid failures caused by prompt excerpt truncation.
      String((c as any)?.bodyFull ?? c?.body ?? ""),
    ]),
  );
  const requireEvidence = allowedEvidence.size > 0;

  const quoteCandidatesByKey = new Map(
    chunkList.map((c) => [
      String(c?.chunkKey ?? "").trim(),
      (Array.isArray((c as any)?.quoteCandidates) ? ((c as any).quoteCandidates as any[]) : [])
        .map((x) => String(x ?? "").trim())
        .filter(Boolean),
    ]),
  );

  const normalizeForContains = (s: string) =>
    String(s ?? "")
      .replace(/[\s\u3000]+/g, "")
      .replace(/[「」『』【】\[\]（）()、。,.!！?？:：;；・\-—―_]/g, "");
  const includesNormalized = (haystack: string, needle: string) => {
    const h = normalizeForContains(haystack);
    const n = normalizeForContains(needle);
    if (!h || !n) return false;
    return h.includes(n);
  };

  const removeCandidateFromText = (text: string, cand: string) => {
    const t0 = String(text ?? "");
    const c0 = String(cand ?? "").trim();
    if (!t0 || !c0) return t0;

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const joiner = "[\\s\\u3000「」『』【】\\[\\]（）()、。,.!！?？:：;；・\\-—―_…]*";
    const chars = Array.from(c0);
    const fuzzy = chars.map((ch) => escapeRegExp(ch)).join(joiner);
    const fuzzyRe = new RegExp(fuzzy, "g");
    const fuzzyReLine = new RegExp(`(?:^|\\n)${fuzzy}(?=\\n|$)`, "g");

    const suffixes = ["", "。", "！", "!", "？", "?", "…", "...", "．", ".", "！\n", "。\n", "？\n", "?\n"];
    let out = t0;
    for (const suf of suffixes) {
      const v = `${c0}${suf}`;
      if (!v) continue;
      if (out.includes(v)) {
        out = out.split(v).join(" ");
      }
      const v2 = `\n${v}`;
      if (out.includes(v2)) {
        out = out.split(v2).join("\n");
      }
    }

    // Fuzzy removal for cases where the model inserts punctuation/whitespace inside the candidate.
    out = out.replace(fuzzyReLine, "\n");
    out = out.replace(fuzzyRe, " ");
    return String(out).replace(/\n\s*\n+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  };

  const allowedKeys = Array.from(allowedEvidence);
  const allowedKeysWithQuotes = allowedKeys.filter((k) => (quoteCandidatesByKey.get(k) ?? []).length > 0);

  const out = posts
    .map((p, postIndex) => {
      let text = stripHashtags(String(p?.text ?? "").trim());
      const themeIndex = Number(p?.themeIndex);
      const sourcesUsedRaw = Array.isArray(p?.sourcesUsed) ? p.sourcesUsed : [];
      const sourcesUsed = sourcesUsedRaw
        .map((s: any) => ({
          platform: (s?.platform === "X" || s?.platform === "THREADS") ? (s.platform as Platform) : args.platform,
          handle: String(s?.handle ?? "").trim(),
        }))
        .filter((s: any) => Boolean(s.handle));
      let evidenceChunkKey = String(p?.evidenceChunkKey ?? "").trim();
      let evidenceQuoteIndexRaw = Number(p?.evidenceQuoteIndex);
      let evidenceQuoteIndex = Number.isFinite(evidenceQuoteIndexRaw) ? evidenceQuoteIndexRaw : NaN;

      // Repair invalid evidenceChunkKey/quoteIndex returned by the model.
      // - If evidenceChunkKey is missing or not in allowedEvidence, try to infer it by matching
      //   any quoteCandidate that appears in the generated text.
      // - Otherwise fall back to the first allowed chunkKey and a valid quoteIndex.
      if (requireEvidence && !enforceEvidence) {
        // Relaxed mode: the model might omit evidence fields entirely.
        // We still want evidenceQuote to be present in the final text and meta, so we deterministically
        // assign a (chunkKey, quoteIndex) and append the quote if necessary.
        const pool = allowedKeysWithQuotes.length > 0 ? allowedKeysWithQuotes : allowedKeys;
        if ((!evidenceChunkKey || !allowedEvidence.has(evidenceChunkKey)) && pool.length > 0) {
          evidenceChunkKey = pool[postIndex % pool.length]!;
        }

        const cands = evidenceChunkKey ? (quoteCandidatesByKey.get(evidenceChunkKey) ?? []) : [];
        if (!Number.isInteger(evidenceQuoteIndex) || evidenceQuoteIndex < 0 || evidenceQuoteIndex >= cands.length) {
          evidenceQuoteIndex = cands.length > 0 ? 0 : NaN;
        }
      }

      if (requireEvidence && enforceEvidence) {
        const keyOk = Boolean(evidenceChunkKey) && allowedEvidence.has(evidenceChunkKey);

        if (!keyOk && allowedKeys.length > 0) {
          let inferredKey: string | null = null;
          let inferredIdx: number | null = null;

          outer: for (const k of allowedKeys) {
            const cands = quoteCandidatesByKey.get(k) ?? [];
            for (let i = 0; i < cands.length; i++) {
              const q = String(cands[i] ?? "").trim();
              if (!q) continue;
              if (includesNormalized(text, q)) {
                inferredKey = k;
                inferredIdx = i;
                break outer;
              }
            }
          }

          if (inferredKey && inferredIdx !== null) {
            evidenceChunkKey = inferredKey;
            evidenceQuoteIndex = inferredIdx;
          } else {
            evidenceChunkKey = (allowedKeysWithQuotes[0] ?? allowedKeys[0])!;
            evidenceQuoteIndex = 0;
          }
        }

        // Ensure quoteIndex is valid for the selected chunk.
        const cands = evidenceChunkKey ? (quoteCandidatesByKey.get(evidenceChunkKey) ?? []) : [];
        if (!Number.isInteger(evidenceQuoteIndex) || evidenceQuoteIndex < 0 || evidenceQuoteIndex >= cands.length) {
          evidenceQuoteIndex = cands.length > 0 ? 0 : NaN;
        }
      }

      const candidates = evidenceChunkKey ? (quoteCandidatesByKey.get(evidenceChunkKey) ?? []) : [];
      const evidenceQuote =
        Number.isInteger(evidenceQuoteIndex) && evidenceQuoteIndex >= 0 && evidenceQuoteIndex < candidates.length
          ? candidates[evidenceQuoteIndex]!
          : "";
      const styleApplied = String(p?.styleApplied ?? "").trim();

      if (requireEvidence && enforceEvidence && evidenceQuote) {
        for (const [k, cands] of quoteCandidatesByKey.entries()) {
          if (!k) continue;
          for (const cand of cands) {
            if (!cand) continue;
            if (cand === evidenceQuote) continue;
            if (includesNormalized(text, cand)) {
              text = stripHashtags(removeCandidateFromText(text, cand));
            }
          }
        }
      }

      // Repair: if model forgot to paste the selected quote into text, append it.
      if (evidenceQuote && !includesNormalized(text, evidenceQuote)) {
        text = stripHashtags(`${text}\n${evidenceQuote}`.trim());
      }

      return { text, themeIndex, sourcesUsed, evidenceChunkKey, evidenceQuoteIndex, evidenceQuote, styleApplied };
    })
    .filter((p) => Boolean(p.text));

  // Auto-deduplicate evidence quotes within a batch to avoid repeated (chunkKey, quoteIndex).
  // This makes evidence diversity deterministic even when the model repeats the same choice.
  if (requireEvidence && enforceEvidence) {
    const usedPairs = new Set<string>();
    const usedIndexByChunk = new Map<string, Set<number>>();

    const markUsed = (key: string, idx: number) => {
      usedPairs.add(`${key}::${idx}`);
      const set = usedIndexByChunk.get(key) ?? new Set<number>();
      set.add(idx);
      usedIndexByChunk.set(key, set);
    };

    for (const p of out as any[]) {
      const key = String(p?.evidenceChunkKey ?? "").trim();
      const idx = Number(p?.evidenceQuoteIndex);
      if (!key || !Number.isInteger(idx)) continue;

      const pairKey = `${key}::${idx}`;
      if (!usedPairs.has(pairKey)) {
        markUsed(key, idx);
        continue;
      }

      const candidates = quoteCandidatesByKey.get(key) ?? [];
      const used = usedIndexByChunk.get(key) ?? new Set<number>();
      const altIdx = candidates.findIndex((_, i) => !used.has(i));
      if (altIdx < 0) {
        // No alternative candidates; keep as-is.
        continue;
      }

      p.evidenceQuoteIndex = altIdx;
      p.evidenceQuote = String(candidates[altIdx] ?? "").trim();
      if (p.evidenceQuote && !includesNormalized(String(p.text ?? ""), p.evidenceQuote)) {
        p.text = stripHashtags(`${String(p.text ?? "").trim()}\n${p.evidenceQuote}`.trim());
      }
      markUsed(key, altIdx);
    }
  }

  if (out.length !== args.count) {
    throw new Error(`OpenAI JSON invalid: posts.length=${out.length} (expected ${args.count})`);
  }

  // Final safety: even in strict mode, ensure evidenceChunkKey is always a valid allowed key.
  // This prevents strict generation from failing due to model hallucinating a key.
  if (requireEvidence && enforceEvidence && allowedKeys.length > 0) {
    const fallbackKey = (allowedKeysWithQuotes[0] ?? allowedKeys[0])!;
    for (const p of out as any[]) {
      const key = String(p?.evidenceChunkKey ?? "").trim();
      if (key && allowedEvidence.has(key)) continue;

      p.evidenceChunkKey = fallbackKey;
      const cands = quoteCandidatesByKey.get(fallbackKey) ?? [];
      p.evidenceQuoteIndex = cands.length > 0 ? 0 : 0;
      p.evidenceQuote = String(cands[0] ?? "").trim();
      if (p.evidenceQuote && !includesNormalized(String(p.text ?? ""), p.evidenceQuote)) {
        p.text = stripHashtags(`${String(p.text ?? "").trim()}\n${p.evidenceQuote}`.trim());
      }
    }
  }

  if (requireEvidence && enforceEvidence) {
    for (const p of out as any[]) {
      const key = String(p?.evidenceChunkKey ?? "").trim();
      if (!key) throw new Error("OpenAI JSON invalid: evidenceChunkKey is required");
      if (!allowedEvidence.has(key)) {
        const allowedPreview = Array.from(allowedEvidence).slice(0, 6).join(", ");
        throw new Error(
          `OpenAI JSON invalid: evidenceChunkKey must match knowledge.primaryChunks[].chunkKey (got='${key}', allowed=[${allowedPreview}])`,
        );
      }

      const idx = Number(p?.evidenceQuoteIndex);
      if (!Number.isInteger(idx)) {
        throw new Error("OpenAI JSON invalid: evidenceQuoteIndex must be an integer");
      }
      const candidates = quoteCandidatesByKey.get(key) ?? [];
      if (idx < 0 || idx >= candidates.length) {
        throw new Error("OpenAI JSON invalid: evidenceQuoteIndex out of range for the selected chunk");
      }
      const quote = String(candidates[idx] ?? "").trim();
      if (!quote) {
        throw new Error("OpenAI JSON invalid: selected evidenceQuote is empty");
      }
      const text = String(p?.text ?? "");
      if (!includesNormalized(text, quote)) {
        throw new Error("OpenAI JSON invalid: selected evidenceQuote must appear in post text");
      }
    }
  }

  const themeCounts = new Array(args.themes.length).fill(0);
  for (const p of out) {
    if (!Number.isFinite(p.themeIndex) || p.themeIndex < 0 || p.themeIndex >= args.themes.length) {
      throw new Error("OpenAI JSON invalid: themeIndex out of range");
    }
    themeCounts[p.themeIndex]++;
  }
  for (let i = 0; i < themeCounts.length; i++) {
    const expected = Number(args.perThemeCounts?.[i] ?? 0) || 0;
    if (themeCounts[i] !== expected) {
      throw new Error(
        `OpenAI JSON invalid: themeIndex=${i} count=${themeCounts[i]} (expected ${expected})`,
      );
    }
  }

  return out;
}

async function generateThemeVariantsWithOpenAI(args: {
  baseTheme: string;
  personaProfile: unknown;
  audience: unknown;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const prompt = {
    language: "ja",
    baseTheme: args.baseTheme,
    persona: args.personaProfile,
    audience: args.audience,
    output: {
      themes: "string[] (length must be 5)",
    },
    rules: [
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      "Generate 5 distinct subtopics derived from baseTheme.",
      "Each theme should be a short Japanese phrase (max 40 chars).",
      "Themes must be mutually distinct and cover different angles.",
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You generate Japanese theme variants for social media posts. Output only valid JSON.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI theme error: ${res.status} ${text}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new Error("OpenAI returned non-JSON content (themes)");
  }

  const parsed = JSON.parse(jsonText) as any;
  const themesRaw = Array.isArray(parsed?.themes) ? (parsed.themes as any[]) : [];
  const themes = themesRaw.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 5);
  if (themes.length !== 5) {
    throw new Error(`OpenAI JSON invalid: themes.length=${themes.length} (expected 5)`);
  }
  return themes;
}

function buildThemeVariantsMock(baseTheme: string) {
  const t = String(baseTheme ?? "").trim() || "無題";
  return [
    `${t}（よくある失敗）`,
    `${t}（具体例）`,
    `${t}（最短手順）`,
    `${t}（考え方）`,
    `${t}（チェックリスト）`,
  ];
}

function computeThemeDistribution(themeCount: number, total: number) {
  const n = Math.max(1, Math.min(themeCount, total));
  const base = Math.floor(total / n);
  const remainder = total % n;
  const counts = Array.from({ length: n }).map((_, i) => base + (i < remainder ? 1 : 0));
  return { counts, n };
}

async function reviewAndRewritePostsWithOpenAI(args: {
  platform: Platform;
  personaProfile: unknown;
  narratorProfile: unknown;
  genreProfile: unknown;
  audience: unknown;
  sources: Array<{ platform: Platform; handle: string; weight: number | null; memo: string | null }>;
  posts: Array<{ text: string; sourcesUsed: Array<{ platform: Platform; handle: string }> }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const maxLen = args.platform === "X" ? 260 : 900;
  const sourceAccountsForPrompt = (Array.isArray(args.sources) ? args.sources : [])
    .filter((s) => String(s?.handle ?? "").trim())
    .map((s) => ({
      platform: s.platform,
      handle: String(s.handle).trim(),
      weight: typeof s.weight === "number" ? s.weight : null,
      memo: s.memo ? String(s.memo) : "",
    }))
    .sort((a, b) => (Number(b.weight ?? 0) || 0) - (Number(a.weight ?? 0) || 0))
    .slice(0, 20);

  const prompt = {
    language: "ja",
    platform: args.platform,
    maxLen,
    persona: args.personaProfile,
    narrator: args.narratorProfile,
    genre: args.genreProfile,
    audience: args.audience,
    sourceAccounts: sourceAccountsForPrompt,
    inputPosts: args.posts,
    output: {
      posts:
        "{textFinal: string, changed: boolean, checks: {lengthOk: boolean, dupOk: boolean, toneOk: boolean, noCopyOk: boolean}, issues: string[], fixSummary: string}[] (same length as inputPosts)",
      summary: "{changedCount: number}"
    },
    rules: [
      `Platform length limit: ${maxLen}.`,
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      "Do NOT include hashtags (e.g., '#就活').",
      "Ensure each post stays within maxLen characters.",
      "Reduce duplication across posts: vary hook/structure/closing.",
      "Keep persona tone and genre constraints.",
      "Keep narrator (author profile) consistent: role/position, personality, background, and constraints must not drift.",
      "Do NOT explicitly state gender (e.g., '私は女性です'). If gender is provided, only let it subtly influence wording.",
      "Source memo is a style reference and MUST NOT override narrator constraints.",
      "Optimize for the provided audience and ensure the text feels appropriate for who/situation/pain/desired/no-go.",
      "Avoid copying from sources; remove any suspicious signature phrases.",
      "Do NOT mention source account names in the post body.",
      "If the post already looks good, set changed=false and keep meaning.",
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You review and rewrite Japanese social media drafts to satisfy constraints. Output only valid JSON with the requested keys.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI review error: ${res.status} ${text}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new Error("OpenAI reviewer returned non-JSON content");
  }

  const parsed = JSON.parse(jsonText) as any;
  const posts = Array.isArray(parsed?.posts) ? (parsed.posts as any[]) : [];
  const summary = parsed?.summary ?? null;

  const out = posts
    .map((p) => {
      const textFinal = stripHashtags(String(p?.textFinal ?? "").trim());
      const changed = Boolean(p?.changed);
      const checks = p?.checks ?? {};
      const issues = Array.isArray(p?.issues) ? p.issues.map((x: any) => String(x ?? "").trim()).filter(Boolean) : [];
      const fixSummary = String(p?.fixSummary ?? "").trim();
      return {
        textFinal,
        changed,
        checks: {
          lengthOk: Boolean(checks?.lengthOk),
          dupOk: Boolean(checks?.dupOk),
          toneOk: Boolean(checks?.toneOk),
          noCopyOk: Boolean(checks?.noCopyOk),
        },
        issues,
        fixSummary,
      };
    })
    .filter((p) => Boolean(p.textFinal));

  if (out.length !== args.posts.length) {
    throw new Error(`OpenAI review JSON invalid: posts.length=${out.length} (expected ${args.posts.length})`);
  }

  const changedCount = Number(summary?.changedCount ?? 0) || out.filter((p) => p.changed).length;
  return { posts: out, changedCount };
}

function pick<T>(arr: T[], idx: number) {
  return arr[idx % arr.length];
}

function clampText(text: string, maxLen: number) {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}

function stripHashtags(text: string) {
  const t = String(text ?? "");
  if (!t) return "";
  // Remove hashtag tokens (e.g. #就活, #job) and also drop lines that become empty.
  const withoutTags = t.replace(/(^|\s)#[^\s#]+/g, " ");
  return withoutTags
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildMockPost(theme: string, platform: Platform, n: number) {
  const safeTheme = (() => {
    const t = String(theme ?? "").trim();
    if (!t) return "無題";
    const qCount = (t.match(/\?/g) ?? []).length;
    const repCount = (t.match(/\uFFFD/g) ?? []).length;
    const badRatio = (qCount + repCount) / Math.max(1, t.length);
    if (badRatio >= 0.3) return "無題";
    return t;
  })();
  const hooks = [
    "最近これで詰まった",
    "これ、意外と落とし穴",
    "今日の学び",
    "やってよかったこと",
    "過去の自分に伝えたい",
    "まず結論",
  ];

  const angles = [
    "失敗から学んだこと",
    "最短で前に進むコツ",
    "メンタルを守るやり方",
    "時間を溶かさない工夫",
    "再現性のある手順",
  ];

  const ctas = [
    "同じ状況の人いたら、どこで詰まってるか教えてください。",
    "もし他に良い方法あったら教えてほしい。",
    "次はここを改善してみます。",
    "やってみた結果もあとで共有します。",
  ];


  const hook = pick(hooks, n);
  const angle = pick(angles, n + 1);
  const cta = pick(ctas, n + 2);
  const lines = [
    `${hook}：「${safeTheme}」`,
    "",
    `- ${angle}：`,
    `  1) まず状況を1行で言語化する`,
    `  2) できることを最小単位に分ける`,
    `  3) 今日やる1つだけ決める`,
    "",
    cta,
  ];

  const text = lines.join("\n");
  return platform === "X" ? clampText(text, 260) : clampText(text, 900);
}

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const workspaceId = String(body.workspaceId ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
    }

    if (!isPlatform(body.platform)) {
      return NextResponse.json({ ok: false, error: "platform is required (X|THREADS)" }, { status: 400 });
    }

    const platform = body.platform;
    const count = Math.max(1, Math.min(200, Number(body.count ?? 30) || 30));
    const theme = String(body.theme ?? "").trim() || "無題";
    const useOpenAI = body.useOpenAI === undefined ? true : Boolean(body.useOpenAI);
    const audienceFromBody = body.audience;

    const [settings, sourcesCount] = await Promise.all([
      prismaAny.workspaceSettings.findUnique({
        where: { workspaceId },
        select: { fixedPersonaId: true, defaultGenreId: true, narratorProfile: true },
      }),
      prismaAny.sourceAccount.count({
        where: { workspaceId, isActive: true, platform },
      }),
    ]);

    const personaId = String(settings?.fixedPersonaId ?? "").trim();
    const genreId = String(settings?.defaultGenreId ?? "").trim();

    const [persona, genre, sources] = await Promise.all([
      personaId
        ? prismaAny.persona.findUnique({ where: { id: personaId }, select: { id: true, profile: true } })
        : Promise.resolve(null),
      genreId
        ? prismaAny.genre.findUnique({ where: { id: genreId }, select: { id: true, profile: true } })
        : Promise.resolve(null),
      prismaAny.sourceAccount.findMany({
        where: { workspaceId, isActive: true, platform },
        orderBy: [{ weight: "desc" }, { createdAt: "asc" }],
        take: 20,
        select: { platform: true, handle: true, weight: true, memo: true },
      }),
    ]);

    const audience =
      audienceFromBody !== undefined
        ? audienceFromBody
        : (persona as any)?.profile?.audience ?? {};

    const retrieved = await retrieveKnowledgeContext({
      workspaceId,
      theme,
      audience,
    });
    let generator: "openai" | "mock" = "mock";
    let llmError: string | null = null;
    let bodies: string[] | null = null;
    let postsForMeta:
      | Array<{
          text: string;
          themeIndex: number;
          sourcesUsed: Array<{ platform: Platform; handle: string }>;
          evidenceChunkKey: string;
          evidenceQuoteIndex: number;
          evidenceQuote: string;
          styleApplied?: string;
        }>
      | null = null;
    let sourcesUsedSummary: Array<{ handle: string; count: number }> = [];
    let styleAppliedSummary: string[] = [];
    let review: { changedCount: number; error: string | null } = { changedCount: 0, error: null };
    let themesUsed: string[] = [];
    let enforceEvidenceUsed: boolean | null = null;
    let strictError: string | null = null;

    if (useOpenAI) {
      try {
        const themes = await generateThemeVariantsWithOpenAI({
          baseTheme: theme,
          personaProfile: persona?.profile ?? {},
          audience,
        });
        const distribution = computeThemeDistribution(themes.length, count);
        const perThemeCounts = distribution.counts;
        const resolvedThemes = themes.slice(0, perThemeCounts.length);

        let posts:
          | Array<{
              text: string;
              themeIndex: number;
              sourcesUsed: Array<{ platform: Platform; handle: string }>;
              evidenceChunkKey: string;
              evidenceQuoteIndex: number;
              evidenceQuote: string;
              styleApplied?: string;
            }>
          | null = null;

        const baseArgs = {
          theme,
          themes: resolvedThemes,
          perThemeCounts,
          platform,
          count,
          personaProfile: persona?.profile ?? {},
          narratorProfile: settings?.narratorProfile ?? {},
          genreProfile: genre?.profile ?? {},
          audience,
          sources: Array.isArray(sources) ? sources : [],
          knowledgeSummary: retrieved.knowledgeSummary,
          primaryChunks: retrieved.primaryChunks.map((c) => ({
            kind: c.kind,
            chunkKey: c.chunkKey,
            title: c.title,
            body: c.body,
            bodyFull: (c as any).bodyFull,
            quoteCandidates: (c as any).quoteCandidates,
            sourceUrl: c.sourceUrl,
          })),
        };

        const runWithRetry = async (enforceEvidence: boolean) => {
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              return await generatePostsWithOpenAI({
                ...(baseArgs as any),
                enforceEvidence,
              });
            } catch (e) {
              lastErr = e;
              if (attempt === 0) continue;
              throw e;
            }
          }
          throw (lastErr instanceof Error ? lastErr : new Error("OpenAI generation failed"));
        };

        try {
          posts = await runWithRetry(true);
          enforceEvidenceUsed = true;
          strictError = null;
        } catch (e) {
          strictError = e instanceof Error ? e.message : "Unknown error";
          posts = await runWithRetry(false);
          enforceEvidenceUsed = false;
        }

        themesUsed = resolvedThemes;

        postsForMeta = posts;

        bodies = posts.map((p) => p.text);

        try {
          const reviewed = await reviewAndRewritePostsWithOpenAI({
            platform,
            personaProfile: persona?.profile ?? {},
            narratorProfile: settings?.narratorProfile ?? {},
            genreProfile: genre?.profile ?? {},
            audience,
            sources: Array.isArray(sources) ? sources : [],
            posts: posts.map((p) => ({ text: p.text, sourcesUsed: p.sourcesUsed ?? [] })),
          });
          const maxLen = platform === "X" ? 260 : 900;
          const reviewedBodies = reviewed.posts.map((p) => clampText(stripHashtags(p.textFinal), maxLen));

          // Keep evidenceQuote present in final text. If review removed it, fall back to the pre-review text.
          const fixedBodies = reviewedBodies.map((t, i) => {
            const quote = String((posts?.[i] as any)?.evidenceQuote ?? "").trim();
            if (!quote) return t;
            if (String(t ?? "").includes(quote)) return t;
            return clampText(stripHashtags(String((posts?.[i] as any)?.text ?? "")), maxLen);
          });

          const stripOtherEvidenceQuotes = (text: string, myIndex: number) => {
            let out = String(text ?? "");
            const suffixes = ["", "。", "！", "!", "？", "?", "…", "...", "．", ".", "\n", "。\n", "！\n", "？\n", "?\n"];
            for (let j = 0; j < (posts?.length ?? 0); j++) {
              if (j === myIndex) continue;
              const q = String((posts?.[j] as any)?.evidenceQuote ?? "").trim();
              if (!q) continue;
              for (const suf of suffixes) {
                const v = `${q}${suf}`;
                if (!v) continue;
                if (out.includes(v)) out = out.split(v).join(" ");
                const v2 = `\n${v}`;
                if (out.includes(v2)) out = out.split(v2).join("\n");
              }
            }
            return out.replace(/\n\s*\n+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
          };

          const cleanedBodies = fixedBodies.map((t, i) => {
            const cleaned = stripOtherEvidenceQuotes(String(t ?? ""), i);
            return clampText(stripHashtags(cleaned), maxLen);
          });

          bodies = cleanedBodies;
          review = { changedCount: reviewed.changedCount, error: null };
        } catch (e) {
          review = { changedCount: 0, error: e instanceof Error ? e.message : "Unknown error" };
        }

        styleAppliedSummary = posts
          .map((p) => String(p.styleApplied ?? "").trim())
          .filter(Boolean)
          .slice(0, 5);

        const counts = new Map<string, number>();
        for (const p of posts) {
          for (const s of p.sourcesUsed ?? []) {
            const h = String(s?.handle ?? "").trim();
            if (!h) continue;
            counts.set(h, (counts.get(h) ?? 0) + 1);
          }
        }
        sourcesUsedSummary = Array.from(counts.entries())
          .map(([handle, c]) => ({ handle, count: c }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        generator = "openai";
      } catch (e) {
        llmError = e instanceof Error ? e.message : "Unknown error";
        bodies = null;
        postsForMeta = null;
        sourcesUsedSummary = [];
        styleAppliedSummary = [];
        review = { changedCount: 0, error: null };
        themesUsed = [];
        enforceEvidenceUsed = null;
        strictError = null;
        generator = "mock";
      }
    }

    if (!useOpenAI || generator !== "openai") {
      const themes = buildThemeVariantsMock(theme);
      const distribution = computeThemeDistribution(Math.min(5, themes.length), count);
      const perThemeCounts = distribution.counts;
      const resolved = themes.slice(0, perThemeCounts.length);
      themesUsed = resolved;
      const outBodies: string[] = [];
      let cursor = 0;
      for (let themeIndex = 0; themeIndex < resolved.length; themeIndex++) {
        const c = perThemeCounts[themeIndex] ?? 0;
        for (let j = 0; j < c; j++) {
          outBodies.push(buildMockPost(resolved[themeIndex] ?? theme, platform, cursor));
          cursor++;
        }
      }
      bodies = outBodies;
      postsForMeta = null;
    }

    const meta = {
      metaVersion: "2025-12-26-evidence-v4",
      generator,
      llmError,
      enforceEvidence: enforceEvidenceUsed,
      strictError,
      review,
      themesUsed,
      knowledge: {
        keywords: retrieved.keywords,
        knowledgeSummaryUsed: Boolean(retrieved.knowledgeSummary),
        knowledgeMeta: retrieved.knowledgeMeta,
        primaryChunksUsed: retrieved.primaryChunks.map((c) => ({
          kind: c.kind,
          chunkKey: c.chunkKey,
          title: c.title,
          sourceUrl: c.sourceUrl,
          quoteCandidateCount: Array.isArray((c as any)?.quoteCandidates) ? ((c as any).quoteCandidates as any[]).length : 0,
        })),
      },
      evidence:
        generator === "openai" && Array.isArray(postsForMeta)
          ? postsForMeta.map((p, i) => {
              const text = String(bodies?.[i] ?? (p as any)?.text ?? "");
              let key = String(p?.evidenceChunkKey ?? "").trim();
              let quote = String((p as any)?.evidenceQuote ?? "").trim();
              let quoteIndex = Number((p as any)?.evidenceQuoteIndex);
              let chunk = key ? retrieved.primaryChunks.find((c) => c.chunkKey === key) : undefined;

              if (!chunk || !key || !quote) {
                let foundKey: string | null = null;
                let foundQuote: string | null = null;
                let foundIndex: number | null = null;

                outer: for (const c of retrieved.primaryChunks) {
                  const cands = Array.isArray((c as any)?.quoteCandidates) ? ((c as any).quoteCandidates as any[]) : [];
                  for (let j = 0; j < cands.length; j++) {
                    const cand = String(cands[j] ?? "").trim();
                    if (!cand) continue;
                    if (text.includes(cand)) {
                      foundKey = String(c.chunkKey ?? "").trim() || null;
                      foundQuote = cand;
                      foundIndex = j;
                      break outer;
                    }
                  }
                }

                if (foundKey && foundQuote && foundIndex !== null) {
                  key = foundKey;
                  quote = foundQuote;
                  quoteIndex = foundIndex;
                  chunk = retrieved.primaryChunks.find((c) => c.chunkKey === key);
                }
              }

              return {
                evidenceChunkKey: key || null,
                evidenceQuoteIndex: Number.isFinite(quoteIndex) ? quoteIndex : null,
                evidenceQuote: quote || null,
                evidenceTitle: chunk?.title ?? null,
                evidenceSourceUrl: chunk?.sourceUrl ?? null,
              };
            })
          : null,
      used: {
        persona: Boolean(personaId && persona),
        genre: Boolean(genreId && genre),
        sources: Number(sourcesCount ?? 0) > 0,
      },
      sourcesUsed: sourcesUsedSummary,
      styleApplied: styleAppliedSummary,
      ids: {
        personaId: personaId || null,
        genreId: genreId || null,
      },
      counts: {
        sourcesActive: Number(sourcesCount ?? 0) || 0,
      },
      note:
        generator === "openai"
          ? "OpenAIで本文を生成しました（persona/genre/参照アカウントを入力に使用）。"
          : "モックで本文を生成しました（OpenAI未使用/失敗時フォールバック）。",
    };

    const rows = Array.from({ length: count }).map((_, i) => {
      const maxLen = platform === "X" ? 260 : 900;

      const stripOtherEvidenceQuotesFinal = (text: string, myIndex: number) => {
        let out = String(text ?? "");
        if (!Array.isArray(postsForMeta) || postsForMeta.length <= 1) return out;

        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const joiner = "[\\s\\u3000「」『』【】\\[\\]（）()、。,.!！?？:：;；・\\-—―_…]*";
        const suffixes = ["", "。", "！", "!", "？", "?", "…", "...", "．", ".", "\n", "。\n", "！\n", "？\n", "?\n"];
        for (let j = 0; j < postsForMeta.length; j++) {
          if (j === myIndex) continue;
          const q = String((postsForMeta[j] as any)?.evidenceQuote ?? "").trim();
          if (!q) continue;

          // 1) Fuzzy regex removal (handles punctuation/whitespace inserted inside the quote).
          const chars = Array.from(q);
          const fuzzy = chars.map((ch) => escapeRegExp(ch)).join(joiner);
          if (fuzzy) {
            try {
              // consume possible trailing punctuation/whitespace as well
              out = out.replace(new RegExp(`${fuzzy}${joiner}`, "g"), " ");
              out = out.replace(new RegExp(`(?:^|\\n)${fuzzy}${joiner}(?=\\n|$)`, "g"), "\n");
              out = out.replace(new RegExp(fuzzy, "g"), " ");
              out = out.replace(new RegExp(`(?:^|\\n)${fuzzy}(?=\\n|$)`, "g"), "\n");
            } catch {
              // ignore invalid regexp edge-cases; exact removal below still applies
            }
          }

          // 2) Exact removal (fast path).
          for (const suf of suffixes) {
            const v = `${q}${suf}`;
            if (!v) continue;
            if (out.includes(v)) out = out.split(v).join(" ");
            const v2 = `\n${v}`;
            if (out.includes(v2)) out = out.split(v2).join("\n");
          }
        }
        return out.replace(/\n\s*\n+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
      };

      const ensureMyEvidenceQuoteFinal = (text: string, myIndex: number) => {
        const myQuote = String((postsForMeta?.[myIndex] as any)?.evidenceQuote ?? "").trim();
        if (!myQuote) return text;
        if (String(text ?? "").includes(myQuote)) return text;
        return `${String(text ?? "").trim()}\n${myQuote}`.trim();
      };

      const cleanupArtifactsFinal = (text: string) => {
        let out = String(text ?? "");
        // Remove lines that are only punctuation/whitespace (common after quote removal).
        out = out.replace(/(?:^|\n)[ \t]*[。．\.・…!！?？、,]+[ \t]*(?=\n|$)/g, "\n");
        // Remove empty bracketed quotes left behind (e.g., "「 」", "『 』", "（ ）").
        out = out.replace(/[「『（(][ \t\u3000]*[」』）)]/g, "");
        // Remove punctuation-only tokens inside a line (e.g. "。 。" or " 。").
        out = out.replace(/[ \t]+[。．\.・…!！?？、,]+(?=\s|$)/g, "");
        // Collapse repeated full stops produced by removals.
        out = out.replace(/[ \t]*[。．\.]{2,}[ \t]*/g, "。");
        // Remove orphaned punctuation like "。 。" that may remain after the above.
        out = out.replace(/[。．\.][ \t]*[。．\.]+/g, "。");
        // Normalize spaces around punctuation.
        out = out.replace(/[ \t]+([。．\.、,!?！？?？])/g, "$1");
        out = out.replace(/\n\s*\n+/g, "\n").trim();
        return out;
      };

      const baseText = bodies?.[i] ? String(bodies[i]) : buildMockPost(theme, platform, i);
      const cleaned = stripOtherEvidenceQuotesFinal(baseText, i);
      const ensured = ensureMyEvidenceQuoteFinal(cleaned, i);
      const finalized = cleanupArtifactsFinal(ensured);
      const bodyText = clampText(stripHashtags(finalized), maxLen);
      return {
        workspaceId,
        platform: platform as any,
        body: stripHashtags(bodyText),
        status: "DRAFT_GENERATED" as const,
      };
    });

    const createdPostDrafts = await prismaAny.$transaction(
      rows.map((data: any, i: number) =>
        prismaAny.postDraft.create({
          data,
          select: { id: true, createdAt: true },
        }),
      ),
    );

    const createdWithEvidence = createdPostDrafts.map((r: any, i: number) => {
      const ev = Array.isArray((meta as any).evidence) ? (meta as any).evidence[i] : null;
      return {
        id: r.id,
        createdAt: r.createdAt,
        evidenceChunkKey: ev?.evidenceChunkKey ?? null,
        evidenceQuoteIndex: ev?.evidenceQuoteIndex ?? null,
        evidenceQuote: ev?.evidenceQuote ?? null,
        evidenceTitle: ev?.evidenceTitle ?? null,
        evidenceSourceUrl: ev?.evidenceSourceUrl ?? null,
      };
    });

    return NextResponse.json(
      { ok: true, created: createdPostDrafts.length, platform, meta, createdPostDrafts: createdWithEvidence },
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
