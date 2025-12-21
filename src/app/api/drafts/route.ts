import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreateDraftBody = {
  workspaceId?: string;
  theme?: string;
  useOpenAI?: boolean;
};

function buildMockVariants(theme: string) {
  const base = theme.trim();

  return {
    A: {
      title: `${base}でまずやること` ,
      body: `結論：${base}は「最初の1歩」を決めると進む。\n\n1) 目的を1行で書く\n2) 失敗しない最小行動を1つ決める\n3) 今日中に5分だけやる\n\nあなたは今日、何から始める？`,
    },
    B: {
      title: `${base}がうまくいかない理由` ,
      body: `「${base}が続かない」のは根性不足じゃない。\n\n原因はだいたいこの3つ：\n- 目標が大きすぎる\n- 手順が曖昧\n- 計測がない\n\n今日やるなら、最小1アクションに落とそう。`,
    },
    C: {
      title: `${base}のテンプレ` ,
      body: `【${base}】\n共感：〜で悩むよね\n問題：〜が詰まる\n解決：〜を1つだけやる\n行動：今日これをやる→\n\n保存してあとで見返してね。`,
    },
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

async function generateVariantsWithOpenAI(args: {
  theme: string;
  personaProfile: unknown;
  genreProfile: unknown;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const prompt = {
    theme: args.theme,
    persona: args.personaProfile,
    genre: args.genreProfile,
    requirements: {
      language: "ja",
      variants: ["A", "B", "C"],
      format: {
        A: { title: "string", body: "string" },
        B: { title: "string", body: "string" },
        C: { title: "string", body: "string" },
      },
      styleNotes: [
        "1投稿として読みやすくする（適度に改行）",
        "結論→理由→行動の流れがあると良い",
        "最後に軽い問いかけ or CTAを入れる",
      ],
    },
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
            "You generate social media post drafts in Japanese. Output only valid JSON with the requested keys.",
        },
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
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
  const variants = {
    A: { title: String(parsed?.A?.title ?? ""), body: String(parsed?.A?.body ?? "") },
    B: { title: String(parsed?.B?.title ?? ""), body: String(parsed?.B?.body ?? "") },
    C: { title: String(parsed?.C?.title ?? ""), body: String(parsed?.C?.body ?? "") },
  };

  if (!variants.A.body || !variants.B.body || !variants.C.body) {
    throw new Error("OpenAI JSON missing required fields");
  }

  return variants;
}

export async function GET() {
  try {
    const drafts = await prisma.draft.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        workspaceId: true,
        theme: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, drafts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateDraftBody;
    const workspaceId = String(body.workspaceId ?? "").trim();
    const theme = String(body.theme ?? "").trim();
    const useOpenAI = Boolean(body.useOpenAI);

    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
    }

    if (!theme) {
      return NextResponse.json({ ok: false, error: "theme is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        settings: {
          select: {
            fixedPersonaId: true,
            defaultGenreId: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ ok: false, error: "workspace not found" }, { status: 404 });
    }

    let variants: any;
    let generator: "openai" | "mock" = "mock";
    let llmError: string | null = null;

    if (useOpenAI) {
      try {
        const personaId = workspace.settings?.fixedPersonaId;
        const genreId = workspace.settings?.defaultGenreId;

        const [persona, genre] = await Promise.all([
          personaId
            ? prisma.persona.findUnique({ where: { id: personaId }, select: { profile: true } })
            : Promise.resolve(null),
          genreId
            ? prisma.genre.findUnique({ where: { id: genreId }, select: { profile: true } })
            : Promise.resolve(null),
        ]);

        variants = await generateVariantsWithOpenAI({
          theme,
          personaProfile: persona?.profile ?? {},
          genreProfile: genre?.profile ?? {},
        });
        generator = "openai";
      } catch (e) {
        llmError = e instanceof Error ? e.message : "Unknown error";
        variants = buildMockVariants(theme);
        generator = "mock";
      }
    } else {
      variants = buildMockVariants(theme);
      generator = "mock";
    }

    const draft = await prisma.draft.create({
      data: {
        workspaceId,
        theme,
        status: "DRAFTED",
        variants,
        formatted: {
          X: {
            A: variants.A.body,
            B: variants.B.body,
            C: variants.C.body,
          },
          THREADS: {
            A: variants.A.body,
            B: variants.B.body,
            C: variants.C.body,
          },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        theme: true,
        status: true,
        variants: true,
        formatted: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, draft, meta: { generator, llmError } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
