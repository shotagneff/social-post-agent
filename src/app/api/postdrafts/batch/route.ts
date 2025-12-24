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
    output: {
      posts:
        "{text: string, themeIndex: 0|1|2|3|4, sourcesUsed: {platform: 'X'|'THREADS', handle: string}[], styleApplied?: string}[] (length must equal count)",
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
      "For each post, choose 1-2 sourceAccounts and set sourcesUsed accordingly.",
      "When selecting sourcesUsed, prefer higher weight accounts, but diversify across posts.",
      "You MUST apply the selected sources' memo as concrete writing directives (tone, structure, hook style, emoji usage, length preference, bullet usage, etc.).",
      "If a selected source has an empty memo, infer a generic but distinct style (e.g., '結論→理由→一言', '箇条書き中心', '短文テンポ').",
      "Treat narrator as the author profile (立場/性別/人物像/背景/価値観/制約) and keep it consistent across all posts.",
      "Do NOT explicitly state gender (e.g., '私は女性です'). If gender is provided, only let it subtly influence wording.",
      "Source memo is a style reference and MUST NOT override narrator constraints (e.g., no煽り, no根拠없는断定, etc.).",
      "Optimize for the provided audience (who/situation/pain/desired/no-go). Make the post feel written for that reader.",
      "Respect audience no-go. Avoid language, claims, or tone that violates it.",
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

  const out = posts
    .map((p) => {
      const text = String(p?.text ?? "").trim();
      const themeIndex = Number(p?.themeIndex);
      const sourcesUsedRaw = Array.isArray(p?.sourcesUsed) ? p.sourcesUsed : [];
      const sourcesUsed = sourcesUsedRaw
        .map((s: any) => ({
          platform: (s?.platform === "X" || s?.platform === "THREADS") ? (s.platform as Platform) : args.platform,
          handle: String(s?.handle ?? "").trim(),
        }))
        .filter((s: any) => Boolean(s.handle));
      const styleApplied = String(p?.styleApplied ?? "").trim();
      return { text, themeIndex, sourcesUsed, styleApplied };
    })
    .filter((p) => Boolean(p.text));

  if (out.length !== args.count) {
    throw new Error(`OpenAI JSON invalid: posts.length=${out.length} (expected ${args.count})`);
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
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      "Keep each textFinal within maxLen characters.",
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
      const textFinal = String(p?.textFinal ?? "").trim();
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

function buildMockPost(theme: string, platform: Platform, n: number) {
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

  const hashtags = [
    "#学び",
    "#仕事術",
    "#就活",
    "#開発",
    "#習慣",
  ];

  const hook = pick(hooks, n);
  const angle = pick(angles, n + 1);
  const cta = pick(ctas, n + 2);
  const tag1 = pick(hashtags, n);
  const tag2 = pick(hashtags, n + 3);

  const lines = [
    `${hook}：「${theme}」`,
    "",
    `- ${angle}：`,
    `  1) まず状況を1行で言語化する`,
    `  2) できることを最小単位に分ける`,
    `  3) 今日やる1つだけ決める`,
    "",
    cta,
    `${tag1} ${tag2}`,
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

    let generator: "openai" | "mock" = "mock";
    let llmError: string | null = null;
    let bodies: string[] | null = null;
    let sourcesUsedSummary: Array<{ handle: string; count: number }> = [];
    let styleAppliedSummary: string[] = [];
    let review: { changedCount: number; error: string | null } = { changedCount: 0, error: null };
    let themesUsed: string[] = [];

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

        const posts = await generatePostsWithOpenAI({
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
        });

        themesUsed = resolvedThemes;

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
          bodies = reviewed.posts.map((p) => clampText(p.textFinal, maxLen));
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
        sourcesUsedSummary = [];
        styleAppliedSummary = [];
        review = { changedCount: 0, error: null };
        themesUsed = [];
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
    }

    const meta = {
      generator,
      llmError,
      review,
      themesUsed,
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

    const rows = Array.from({ length: count }).map((_, i) => ({
      workspaceId,
      platform: platform as any,
      body: bodies?.[i] ? clampText(String(bodies[i]), platform === "X" ? 260 : 900) : buildMockPost(theme, platform, i),
      status: "DRAFT_GENERATED" as const,
    }));

    const created = await prismaAny.postDraft.createMany({
      data: rows,
    });

    return NextResponse.json({ ok: true, created: created.count, platform, meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
