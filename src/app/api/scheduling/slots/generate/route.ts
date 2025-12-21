import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Platform = "X" | "THREADS";

type CoreTimeWindow = {
  daysOfWeek: number[]; // 0=Sun ... 6=Sat
  startTime: string; // HH:MM
  endTime: string; // HH:MM
};

type SchedulingPolicy = {
  timezone?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dailyPostLimit: Record<Platform, number>;
  coreTimeWindows: CoreTimeWindow[];
  minIntervalMinutes?: number;
  randomJitterMinutes?: number;
  skipHolidays?: boolean;
};

type GenerateBody = {
  workspaceId?: string;
};

function tzOffsetMinutes(timezone: string) {
  // MVP: requirements assume Asia/Tokyo. Add more timezones later.
  if (timezone === "Asia/Tokyo") return 9 * 60;
  return null;
}

function parseDateYmd(value: string): { y: number; m: number; d: number } | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function parseHm(value: string): { h: number; m: number } | null {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

function hashToUnit(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function isoDateFromLocalYmd(ymd: { y: number; m: number; d: number }) {
  const y = String(ymd.y).padStart(4, "0");
  const m = String(ymd.m).padStart(2, "0");
  const d = String(ymd.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localYmdToUtcDate(ymd: { y: number; m: number; d: number }, offsetMin: number) {
  // local midnight -> UTC
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0) - offsetMin * 60_000);
}

function localDateTimeToUtcDate(
  ymd: { y: number; m: number; d: number },
  hm: { h: number; m: number },
  offsetMin: number,
) {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, hm.h, hm.m, 0) - offsetMin * 60_000);
}

function dayOfWeekInTimezone(ymd: { y: number; m: number; d: number }, offsetMin: number) {
  const utc = localYmdToUtcDate(ymd, offsetMin);
  // Convert back to "local" by adding offset, then take UTCDay
  const local = new Date(utc.getTime() + offsetMin * 60_000);
  return local.getUTCDay();
}

function addDaysLocal(ymd: { y: number; m: number; d: number }, days: number) {
  const utc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days, 0, 0, 0));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as GenerateBody;
    const workspaceId = String(body.workspaceId ?? "").trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId },
      select: { workspaceId: true, timezone: true, schedulingPolicy: true },
    });

    if (!settings) {
      return NextResponse.json({ ok: false, error: "workspace settings not found" }, { status: 404 });
    }

    const policy = (settings.schedulingPolicy ?? {}) as SchedulingPolicy;

    const timezone = String((policy as any).timezone ?? settings.timezone ?? "Asia/Tokyo");
    const offsetMin = tzOffsetMinutes(timezone);
    if (offsetMin === null) {
      return NextResponse.json(
        { ok: false, error: "timezone is not supported yet (use Asia/Tokyo)" },
        { status: 400 },
      );
    }

    const start = parseDateYmd(String((policy as any).startDate ?? ""));
    const end = parseDateYmd(String((policy as any).endDate ?? ""));
    if (!start || !end) {
      return NextResponse.json(
        { ok: false, error: "startDate/endDate must be YYYY-MM-DD and startDate <= endDate" },
        { status: 400 },
      );
    }

    const startUtc = localYmdToUtcDate(start, offsetMin);
    const endUtc = localYmdToUtcDate(end, offsetMin);
    if (startUtc.getTime() > endUtc.getTime()) {
      return NextResponse.json(
        { ok: false, error: "startDate/endDate must be YYYY-MM-DD and startDate <= endDate" },
        { status: 400 },
      );
    }

    const dailyPostLimit = (policy as any).dailyPostLimit as Record<Platform, number> | undefined;
    if (!dailyPostLimit || typeof dailyPostLimit !== "object") {
      return NextResponse.json({ ok: false, error: "dailyPostLimit is required" }, { status: 400 });
    }

    const coreTimeWindows = (policy as any).coreTimeWindows as CoreTimeWindow[] | undefined;
    if (!Array.isArray(coreTimeWindows) || coreTimeWindows.length === 0) {
      return NextResponse.json({ ok: false, error: "coreTimeWindows is required" }, { status: 400 });
    }

    const minIntervalMinutes = Math.max(0, Number((policy as any).minIntervalMinutes ?? 0) || 0);
    const randomJitterMinutes = Math.max(0, Number((policy as any).randomJitterMinutes ?? 0) || 0);

    const platforms: Platform[] = ["X", "THREADS"];

    const rows: { workspaceId: string; platform: Platform; scheduledAt: Date }[] = [];

    for (let day = start; ; day = addDaysLocal(day, 1)) {
      const dayUtc = localYmdToUtcDate(day, offsetMin);
      if (dayUtc.getTime() > endUtc.getTime()) break;
      const dow = dayOfWeekInTimezone(day, offsetMin);

      for (const platform of platforms) {
        const limit = Math.max(0, Number((dailyPostLimit as any)[platform] ?? 0) || 0);
        if (limit === 0) continue;

        const windows = coreTimeWindows.filter((w) => Array.isArray(w.daysOfWeek) && w.daysOfWeek.includes(dow));
        if (windows.length === 0) continue;

        const generated: Date[] = [];

        for (let i = 0; i < limit; i++) {
          const w = windows[i % windows.length];
          const st = parseHm(String(w.startTime ?? ""));
          const en = parseHm(String(w.endTime ?? ""));
          if (!st || !en) continue;

          const windowStart = localDateTimeToUtcDate(day, st, offsetMin);
          const windowEnd = localDateTimeToUtcDate(day, en, offsetMin);
          if (windowEnd.getTime() <= windowStart.getTime()) continue;

          const spanMin = Math.floor((windowEnd.getTime() - windowStart.getTime()) / 60_000);
          const baseOffset = Math.floor(((i + 0.5) / limit) * spanMin);

          const jitterSeed = `${workspaceId}:${platform}:${isoDateFromLocalYmd(day)}:${i}`;
          const jitter = randomJitterMinutes
            ? Math.round((hashToUnit(jitterSeed) * 2 - 1) * randomJitterMinutes)
            : 0;

          let t = addMinutes(windowStart, baseOffset + jitter);
          if (t.getTime() < windowStart.getTime()) t = windowStart;
          if (t.getTime() > windowEnd.getTime()) t = windowEnd;

          generated.push(t);
        }

        generated.sort((a, b) => a.getTime() - b.getTime());

        const adjusted: Date[] = [];
        for (const t0 of generated) {
          let t = t0;
          const prev = adjusted[adjusted.length - 1];
          if (prev && minIntervalMinutes > 0) {
            const minNext = addMinutes(prev, minIntervalMinutes);
            if (t.getTime() < minNext.getTime()) {
              t = minNext;
            }
          }
          adjusted.push(t);
        }

        for (const t of adjusted) {
          rows.push({ workspaceId, platform, scheduledAt: t });
        }
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, created: 0, skipped: 0 });
    }

    const result = await prisma.schedulingSlot.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return NextResponse.json({ ok: true, created: result.count, requested: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
