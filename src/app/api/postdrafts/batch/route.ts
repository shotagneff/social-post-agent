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
  platform: Platform;
  count: number;
  personaProfile: unknown;
  genreProfile: unknown;
  sources: Array<{ platform: Platform; handle: string; weight: number | null; memo: string | null }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const maxLen = args.platform === "X" ? 260 : 900;
  const prompt = {
    language: "ja",
    platform: args.platform,
    count: args.count,
    maxLen,
    theme: args.theme,
    persona: args.personaProfile,
    genre: args.genreProfile,
    sourceAccounts: args.sources,
    output: {
      posts: "{text: string, sourcesUsed: {platform: 'X'|'THREADS', handle: string}[]}[] (length must equal count)",
    },
    rules: [
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      "Each post must be self-contained.",
      "Keep within maxLen characters; if close, prefer shorter.",
      "Avoid repeating the same hook across posts; vary angles.",
      "For each post, choose 1-2 sourceAccounts and set sourcesUsed accordingly.",
      "Do NOT copy phrases, unique catchphrases, or structure verbatim from sources; only use them as inspiration for tone/angles/structure.",
      "Avoid mentioning the source account names in the post body.",
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
      const sourcesUsedRaw = Array.isArray(p?.sourcesUsed) ? p.sourcesUsed : [];
      const sourcesUsed = sourcesUsedRaw
        .map((s: any) => ({
          platform: (s?.platform === "X" || s?.platform === "THREADS") ? (s.platform as Platform) : args.platform,
          handle: String(s?.handle ?? "").trim(),
        }))
        .filter((s: any) => Boolean(s.handle));
      return { text, sourcesUsed };
    })
    .filter((p) => Boolean(p.text));

  if (out.length !== args.count) {
    throw new Error(`OpenAI JSON invalid: posts.length=${out.length} (expected ${args.count})`);
  }

  return out;
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

    const [settings, sourcesCount] = await Promise.all([
      prismaAny.workspaceSettings.findUnique({
        where: { workspaceId },
        select: { fixedPersonaId: true, defaultGenreId: true },
      }),
      prismaAny.sourceAccount.count({
        where: { workspaceId, isActive: true },
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
        where: { workspaceId, isActive: true },
        orderBy: [{ weight: "desc" }, { createdAt: "asc" }],
        take: 20,
        select: { platform: true, handle: true, weight: true, memo: true },
      }),
    ]);

    let generator: "openai" | "mock" = "mock";
    let llmError: string | null = null;
    let bodies: string[] | null = null;
    let sourcesUsedSummary: Array<{ handle: string; count: number }> = [];

    if (useOpenAI) {
      try {
        const posts = await generatePostsWithOpenAI({
          theme,
          platform,
          count,
          personaProfile: persona?.profile ?? {},
          genreProfile: genre?.profile ?? {},
          sources: Array.isArray(sources) ? sources : [],
        });

        bodies = posts.map((p) => p.text);
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
        generator = "mock";
      }
    }

    const meta = {
      generator,
      llmError,
      used: {
        persona: Boolean(personaId && persona),
        genre: Boolean(genreId && genre),
        sources: Number(sourcesCount ?? 0) > 0,
      },
      sourcesUsed: sourcesUsedSummary,
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
