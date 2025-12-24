import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type ThemeItem = {
  id: string;
  title: string;
  enabled: boolean;
};

type ThemesByPlatform = {
  version: number;
  X: { items: ThemeItem[] };
  THREADS: { items: ThemeItem[] };
};

type PutBody = {
  items?: unknown;
};

function isPlatform(value: unknown): value is Platform {
  return value === "X" || value === "THREADS";
}

function uuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeThemes(raw: unknown): ThemesByPlatform {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const version = Number((obj as any).version ?? 1) || 1;

  function normalizeItems(itemsRaw: unknown): ThemeItem[] {
    const list = Array.isArray(itemsRaw) ? itemsRaw : [];
    return list
      .map((x) => {
        const it = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const id = String(it.id ?? "").trim() || uuid();
        const title = String(it.title ?? "").trim();
        const enabled = it.enabled === undefined ? true : Boolean(it.enabled);
        return { id, title, enabled };
      })
      .filter((x) => Boolean(x.title));
  }

  const xObj = (obj as any).X && typeof (obj as any).X === "object" ? (obj as any).X : {};
  const tObj = (obj as any).THREADS && typeof (obj as any).THREADS === "object" ? (obj as any).THREADS : {};

  return {
    version,
    X: { items: normalizeItems((xObj as any).items) },
    THREADS: { items: normalizeItems((tObj as any).items) },
  };
}

function pickPlatformThemes(all: ThemesByPlatform, platform: Platform) {
  return platform === "X" ? all.X.items : all.THREADS.items;
}

export async function GET(req: Request, ctx: { params: Promise<{ id?: string }> }) {
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

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: id },
      select: { workspaceId: true, themesByPlatform: true, updatedAt: true },
    });

    if (!settings) {
      return NextResponse.json({ ok: false, error: "workspace settings not found" }, { status: 404 });
    }

    const themesByPlatform = normalizeThemes(settings.themesByPlatform);
    const items = pickPlatformThemes(themesByPlatform, platform);

    return NextResponse.json({ ok: true, workspaceId: id, platform, items, updatedAt: settings.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id?: string }> }) {
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

    const body = (await req.json().catch(() => ({}))) as PutBody;
    const rawItems = body.items;
    if (rawItems === undefined) {
      return NextResponse.json({ ok: false, error: "items is required" }, { status: 400 });
    }

    const incomingList = Array.isArray(rawItems) ? rawItems : [];
    const normalizedItems: ThemeItem[] = incomingList
      .map((x) => {
        const it = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const id0 = String(it.id ?? "").trim() || uuid();
        const title = String(it.title ?? "").trim();
        const enabled = it.enabled === undefined ? true : Boolean(it.enabled);
        return { id: id0, title, enabled };
      })
      .filter((x) => Boolean(x.title))
      .slice(0, 50);

    const current = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: id },
      select: { themesByPlatform: true },
    });

    const merged = normalizeThemes(current?.themesByPlatform);
    if (platform === "X") {
      merged.X.items = normalizedItems;
    } else {
      merged.THREADS.items = normalizedItems;
    }

    const settings = await prisma.workspaceSettings.upsert({
      where: { workspaceId: id },
      create: {
        workspaceId: id,
        timezone: "Asia/Tokyo",
        postingTargets: [],
        schedulingPolicy: {},
        themesByPlatform: merged as any,
      },
      update: {
        themesByPlatform: merged as any,
      },
      select: { workspaceId: true, themesByPlatform: true, updatedAt: true },
    });

    const themesByPlatform = normalizeThemes(settings.themesByPlatform);
    const items = pickPlatformThemes(themesByPlatform, platform);

    return NextResponse.json({ ok: true, workspaceId: id, platform, items, updatedAt: settings.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
