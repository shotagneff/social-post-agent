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
};

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

    const [persona, genre] = await Promise.all([
      personaId
        ? prismaAny.persona.findUnique({ where: { id: personaId }, select: { id: true } })
        : Promise.resolve(null),
      genreId
        ? prismaAny.genre.findUnique({ where: { id: genreId }, select: { id: true } })
        : Promise.resolve(null),
    ]);

    const meta = {
      generator: "mock" as const,
      used: {
        persona: Boolean(personaId && persona),
        genre: Boolean(genreId && genre),
        sources: Number(sourcesCount ?? 0) > 0,
      },
      ids: {
        personaId: personaId || null,
        genreId: genreId || null,
      },
      counts: {
        sourcesActive: Number(sourcesCount ?? 0) || 0,
      },
      note:
        "現在の /api/postdrafts/batch はモック生成です（本文には persona/genre/sources をまだ反映していません）。次ステップでLLM生成に置換します。",
    };

    const rows = Array.from({ length: count }).map((_, i) => ({
      workspaceId,
      platform: platform as any,
      body: buildMockPost(theme, platform, i),
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
