import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type Body = {
  seed?: string;
  count?: number;
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

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

function summarizeAudience(audience: unknown) {
  const a = audience && typeof audience === "object" ? (audience as Record<string, unknown>) : {};
  const who = String((a as any).who ?? "").trim();
  const situation = String((a as any).situation ?? "").trim();
  const pain = String((a as any).pain ?? "").trim();
  const desired = String((a as any).desired ?? "").trim();
  const noGo = String((a as any)["no-go"] ?? (a as any).noGo ?? "").trim();

  const parts = [
    who ? `対象: ${who}` : "",
    situation ? `状況: ${situation}` : "",
    pain ? `悩み: ${pain}` : "",
    desired ? `理想: ${desired}` : "",
    noGo ? `NG: ${noGo}` : "",
  ].filter(Boolean);

  return {
    who,
    situation,
    pain,
    desired,
    noGo,
    text: parts.join(" / "),
  };
}

async function generateThemeVariantsWithOpenAI(args: {
  platform: Platform;
  seed: string;
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
    seed: args.seed,
    persona: args.personaProfile,
    narrator: args.narratorProfile,
    genre: args.genreProfile,
    audience: args.audience,
    sourceAccounts: sourceAccountsForPrompt,
    output: {
      themes: `string[] (length must be ${args.count})`,
    },
    rules: [
      "Return ONLY valid JSON.",
      "Do not include markdown.",
      `Generate exactly ${args.count} themes for social media posting.`,
      "Each theme should be a short Japanese phrase (max 40 chars).",
      "Themes must be mutually distinct and cover different angles.",
      "Themes should be actionable and lead to concrete posts.",
      "The audience is the PRIMARY constraint. Interpret seed through the audience context; do not generate generic topics unrelated to the audience.",
      "If audience.who is present, ensure the themes clearly fit that person. If the audience implies a specific domain (e.g., job hunting), keep the themes within that domain.",
      "Optimize for the provided audience (who/situation/pain/desired/no-go).",
      "Respect audience no-go.",
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
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You generate Japanese theme ideas for social media posts. Output only valid JSON.",
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
  const themes = themesRaw.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, args.count);
  if (themes.length !== args.count) {
    throw new Error(`OpenAI JSON invalid: themes.length=${themes.length} (expected ${args.count})`);
  }

  return themes;
}

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const url = new URL(req.url);
    const platformRaw = url.searchParams.get("platform");
    const platform = platformRaw === null ? null : (platformRaw as any);
    if (!isPlatform(platform)) {
      return NextResponse.json({ ok: false, error: "platform is required (X|THREADS)" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const count = Math.max(1, Math.min(10, Number(body.count ?? 5) || 5));
    const seed = String(body.seed ?? "").trim();
    const useOpenAI = body.useOpenAI === undefined ? true : Boolean(body.useOpenAI);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: id },
      select: { fixedPersonaId: true, defaultGenreId: true, narratorProfile: true },
    });

    const personaId = String(settings?.fixedPersonaId ?? "").trim();
    const genreId = String(settings?.defaultGenreId ?? "").trim();

    const [persona, genre, sources] = await Promise.all([
      personaId
        ? prisma.persona.findUnique({ where: { id: personaId }, select: { id: true, profile: true } })
        : Promise.resolve(null),
      genreId
        ? prisma.genre.findUnique({ where: { id: genreId }, select: { id: true, profile: true } })
        : Promise.resolve(null),
      prisma.sourceAccount.findMany({
        where: { workspaceId: id, isActive: true, platform },
        orderBy: [{ weight: "desc" }, { createdAt: "asc" }],
        take: 20,
        select: { platform: true, handle: true, weight: true, memo: true },
      }),
    ]);

    const audience = (persona as any)?.profile?.audience ?? {};
    const audienceSummary = summarizeAudience(audience);

    if (!useOpenAI) {
      const base = seed || "テーマ";
      const themes = Array.from({ length: count }).map((_, i) => `${base}（案${i + 1}）`);
      return NextResponse.json({
        ok: true,
        platform,
        themes,
        generator: "mock",
        debug: {
          personaId: personaId || null,
          genreId: genreId || null,
          audienceSummary,
          seed: seed || null,
        },
      });
    }

    const derivedSeed = seed || "この投稿設計に合うテーマ案";

    const themes = await generateThemeVariantsWithOpenAI({
      platform,
      seed: derivedSeed,
      count,
      personaProfile: persona?.profile ?? {},
      narratorProfile: settings?.narratorProfile ?? {},
      genreProfile: genre?.profile ?? {},
      audience,
      sources: Array.isArray(sources) ? (sources as any) : [],
    });

    return NextResponse.json({
      ok: true,
      platform,
      themes,
      generator: "openai",
      debug: {
        personaId: personaId || null,
        genreId: genreId || null,
        audienceSummary,
        seed: derivedSeed,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
