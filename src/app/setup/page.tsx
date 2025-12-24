"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Platform = "X" | "THREADS";

type SourceAccount = {
  platform: Platform;
  handle: string;
  weight?: number;
  memo?: string;
};

function normalizeHandle(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function validateHandle(platform: Platform, handle: string) {
  const h = normalizeHandle(handle);
  if (!h) return "handle は必須です";

  const body = h.slice(1);
  if (!body) return "handle は必須です";

  if (platform === "X") {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(body)) {
      return "Xのhandleは英数字と_のみ（1〜15文字）です";
    }
    return "";
  }

  if (!/^[A-Za-z0-9._]{1,30}$/.test(body)) {
    return "Threadsのhandleは英数字と._のみ（1〜30文字）です";
  }
  return "";
}

type CoreTimeWindow = {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
};

type WorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  settings?: {
    timezone: string;
  } | null;
};

type SetupStep =
  | "workspace"
  | "persona"
  | "narrator"
  | "genre"
  | "sources"
  | "confirm"
  | "scheduling";

function stepTitle(step: SetupStep) {
  switch (step) {
    case "workspace":
      return "1. 投稿設計";
    case "persona":
      return "2. ペルソナ";
    case "narrator":
      return "3. 語り手";
    case "genre":
      return "4. フォーマット";
    case "sources":
      return "5. 参照アカウント";
    case "confirm":
      return "6. 確認";
    case "scheduling":
      return "7. 投稿枠（スケジューリング）";
  }
}

type NarratorPoliteness = "casual" | "polite";
type NarratorGender = "unspecified" | "female" | "male" | "other";

type NarratorProfile = {
  roleOrPosition: string;
  gender: NarratorGender;
  personality: string;
  background: string;
  notes: string;
  version: 1;
};

type AudienceProfile = {
  who: string;
  situation: string;
  pain: string;
  desired: string;
  noGo: string;
};

type FormatPreset = {
  key: string;
  label: string;
  profile: unknown;
};

const FORMAT_PRESETS: FormatPreset[] = [
  {
    key: "news-summary",
    label: "ニュース要約（結論→要点→一言）",
    profile: {
      kind: "format",
      structure: "結論1行→要点3つ→補足1行→一言で締める",
      cta: "任意（最後に軽く問いかけても良い）",
      bullets: { preferred: true, maxItems: 5 },
      lineBreaks: { preferred: true },
      version: 1,
    },
  },
  {
    key: "checklist",
    label: "チェックリスト（3〜7項目）",
    profile: {
      kind: "format",
      structure: "冒頭1行→チェック項目（3〜7）→最後に1行",
      cta: "保存/あとで見返す系の一言 or 質問で締める",
      bullets: { preferred: true, maxItems: 7 },
      lineBreaks: { preferred: true },
      version: 1,
    },
  },
  {
    key: "how-to",
    label: "手順（Step 1→2→3）",
    profile: {
      kind: "format",
      structure: "結論→手順（Step 1〜3）→注意点→締め",
      cta: "やってみたらどうだった？で締める",
      bullets: { preferred: true, maxItems: 6 },
      lineBreaks: { preferred: true },
      version: 1,
    },
  },
];

function Stepper(props: { steps: string[]; currentIndex: number }) {
  const { steps, currentIndex } = props;
  return (
    <div className="spa-card p-4">
      <div className="flex flex-wrap gap-2">
        {steps.map((label, idx) => {
          const done = idx < currentIndex;
          const active = idx === currentIndex;
          const circleClass = done
            ? "bg-black text-white"
            : active
              ? "border-black text-black"
              : "border-zinc-300 text-zinc-500";

          const textClass = done ? "text-black" : active ? "text-black" : "text-zinc-500";

          return (
            <div key={`${idx}-${label}`} className={`flex items-center gap-2 ${textClass}`}
            >
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${circleClass}`}
              >
                {idx + 1}
              </div>
              <div className="text-xs font-medium">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ymdToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
  if (!m) return ymd;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export default function SetupPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("マイ投稿設計");
  const [timezone, setTimezone] = useState("Asia/Tokyo");
  const [postingTargets, setPostingTargets] = useState<Platform[]>(["X"]);

  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  const [useExistingWorkspace, setUseExistingWorkspace] = useState<boolean>(false);
  const [selectedExistingWorkspaceId, setSelectedExistingWorkspaceId] = useState<string>("");

  const [personaJson, setPersonaJson] = useState<string>(
    JSON.stringify(
      {
        name: "",
        experience: "",
        beliefs: [],
        audience: {
          who: "",
          situation: "",
          pain: "",
          desired: "",
          noGo: "",
        },
        tone: { assertiveness: 0.6, empathy: 0.6 },
        banned_expressions: [],
        allowed_expressions: [],
        version: 1,
      },
      null,
      2,
    ),
  );

  const [audienceWho, setAudienceWho] = useState<string>("");
  const [audienceSituation, setAudienceSituation] = useState<string>("");
  const [audiencePain, setAudiencePain] = useState<string>("");
  const [audienceDesired, setAudienceDesired] = useState<string>("");
  const [audienceNoGo, setAudienceNoGo] = useState<string>("");

  const audienceProfile: AudienceProfile = useMemo(() => {
    return {
      who: String(audienceWho ?? "").trim(),
      situation: String(audienceSituation ?? "").trim(),
      pain: String(audiencePain ?? "").trim(),
      desired: String(audienceDesired ?? "").trim(),
      noGo: String(audienceNoGo ?? "").trim(),
    };
  }, [audienceDesired, audienceNoGo, audiencePain, audienceSituation, audienceWho]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(personaJson);
      if (typeof parsed !== "object" || parsed === null) return;
      const next = { ...(parsed as any), audience: audienceProfile };
      setPersonaJson(JSON.stringify(next, null, 2));
    } catch {
      // If personaJson is invalid while editing, do not overwrite.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceProfile]);

  const [narratorRoleOrPosition, setNarratorRoleOrPosition] = useState<string>("");
  const [narratorGender, setNarratorGender] = useState<NarratorGender>("unspecified");
  const [narratorPersonality, setNarratorPersonality] = useState<string>("");
  const [narratorBackground, setNarratorBackground] = useState<string>("");
  const [narratorNotes, setNarratorNotes] = useState<string>("");

  const narratorProfile: NarratorProfile = useMemo(() => {
    return {
      roleOrPosition: String(narratorRoleOrPosition ?? "").trim(),
      gender: narratorGender,
      personality: String(narratorPersonality ?? "").trim(),
      background: String(narratorBackground ?? "").trim(),
      notes: String(narratorNotes ?? "").trim(),
      version: 1,
    };
  }, [narratorBackground, narratorGender, narratorNotes, narratorPersonality, narratorRoleOrPosition]);

  const narratorProfileJson = useMemo(() => JSON.stringify(narratorProfile), [narratorProfile]);

  const [genreKey, setGenreKey] = useState<string>("");
  const [genreJson, setGenreJson] = useState<string>("{}");

  const [sourceAccountRows, setSourceAccountRows] = useState<SourceAccount[]>([
    { platform: "X", handle: "@example1", weight: 3, memo: "結論→理由→一言で締める" },
    { platform: "X", handle: "@example2", weight: 1, memo: "箇条書き多めで短文テンポ" },
    { platform: "THREADS", handle: "@example3", weight: 2, memo: "問いかけで締める" },
  ]);

  const sourceAccountRowErrors = useMemo(() => {
    return (Array.isArray(sourceAccountRows) ? sourceAccountRows : []).map((r) =>
      validateHandle(r.platform, r.handle),
    );
  }, [sourceAccountRows]);

  const sourceAccounts = useMemo<SourceAccount[]>(() => {
    return (Array.isArray(sourceAccountRows) ? sourceAccountRows : [])
      .map((r) => ({
        platform: r.platform,
        handle: normalizeHandle(String(r.handle ?? "")),
        weight: typeof r.weight === "number" && Number.isFinite(r.weight) ? r.weight : undefined,
        memo: r.memo ? String(r.memo).trim() : undefined,
      }))
      .filter((r) => (r.platform === "X" || r.platform === "THREADS") && !validateHandle(r.platform, r.handle));
  }, [sourceAccountRows]);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string>("");

  const [step, setStep] = useState<SetupStep>("workspace");

  const [policyStartDate, setPolicyStartDate] = useState<string>(ymdToday());
  const [policyEndDate, setPolicyEndDate] = useState<string>(addDaysYmd(ymdToday(), 30));
  const [dailyLimitX, setDailyLimitX] = useState<number>(1);
  const [dailyLimitThreads, setDailyLimitThreads] = useState<number>(0);
  const [minIntervalMinutes, setMinIntervalMinutes] = useState<number>(90);
  const [randomJitterMinutes, setRandomJitterMinutes] = useState<number>(15);
  const [coreTimeWindows, setCoreTimeWindows] = useState<CoreTimeWindow[]>([
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "08:30", endTime: "10:30" },
  ]);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyResult, setPolicyResult] = useState<string>("");
  const [slotGenerating, setSlotGenerating] = useState(false);
  const [slotResult, setSlotResult] = useState<string>("");

  const genreJsonValid = useMemo(() => {
    if (!String(genreKey ?? "").trim()) return true;
    try {
      const parsed = JSON.parse(genreJson);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  }, [genreJson, genreKey]);

  const canGoNextWorkspace = Boolean(workspaceName.trim() && timezone.trim());
  const canGoNextPersona = Boolean(
    String(audienceWho ?? "").trim() ||
      String(audienceDesired ?? "").trim() ||
      String(audienceSituation ?? "").trim() ||
      String(audiencePain ?? "").trim() ||
      String(audienceNoGo ?? "").trim(),
  );
  const canGoNextNarrator = useMemo(() => {
    const hasRole = String(narratorRoleOrPosition ?? "").trim().length > 0;
    const hasNotes = String(narratorNotes ?? "").trim().length > 0;
    return hasRole || hasNotes;
  }, [narratorNotes, narratorRoleOrPosition]);
  const canGoNextGenre = Boolean(genreJsonValid);
  const canGoNextSources = sourceAccounts.length > 0;
  const canRun = canGoNextWorkspace && canGoNextPersona && canGoNextNarrator && canGoNextGenre && canGoNextSources;

  const stepOrder: SetupStep[] = [
    "workspace",
    "persona",
    "narrator",
    "genre",
    "sources",
    "confirm",
    "scheduling",
  ];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  const stepLabels = [
    "投稿設計",
    "ペルソナ",
    "語り手",
    "フォーマット",
    "参照アカウント",
    "確認",
    "投稿枠",
  ];

  useEffect(() => {
    function applyForcedStep() {
      if (typeof window === "undefined") return;
      const forced = String(new URLSearchParams(window.location.search).get("step") ?? "").trim();
      if (!forced) return;
      if (
        forced === "workspace" ||
        forced === "persona" ||
        forced === "narrator" ||
        forced === "genre" ||
        forced === "sources" ||
        forced === "confirm" ||
        forced === "scheduling"
      ) {
        setStep(forced);
      }
    }

    applyForcedStep();
    window.addEventListener("popstate", applyForcedStep);
    return () => {
      window.removeEventListener("popstate", applyForcedStep);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    setWorkspacesLoading(true);
    setWorkspacesError("");
    fetch("/api/workspaces", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (canceled) return;
        if (!json?.ok) {
          setWorkspacesError(`エラー: ${json?.error ?? "不明なエラー"}`);
          setWorkspaces([]);
          return;
        }

        const list = Array.isArray(json.workspaces) ? (json.workspaces as WorkspaceItem[]) : [];
        setWorkspaces(list);

        const initial = String(list[0]?.id ?? "").trim();
        if (initial) {
          setSelectedExistingWorkspaceId(initial);
          setUseExistingWorkspace(true);

          // Keep a sensible default selection, but don't force-jump the user to step 6.
          setWorkspaceId(initial);
          setResult("");
          setPolicyResult("");
          setSlotResult("");
        }
      })
      .catch((e) => {
        if (canceled) return;
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setWorkspacesError(`エラー: ${msg}`);
        setWorkspaces([]);
      })
      .finally(() => {
        if (canceled) return;
        setWorkspacesLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (workspaceId.trim()) {
      window.localStorage.setItem("lastWorkspaceId", workspaceId.trim());
    }
  }, [workspaceId]);

  useEffect(() => {
    if (step !== "workspace") return;
    if (!useExistingWorkspace) return;
    const id = String(selectedExistingWorkspaceId ?? "").trim();
    if (!id) return;
    setWorkspaceId(id);
    setResult("");
    setPolicyResult("");
    setSlotResult("");
  }, [selectedExistingWorkspaceId, step, useExistingWorkspace]);

  async function submit() {
    setSubmitting(true);
    setResult("");

    const genreKeyForSubmit = String(genreKey ?? "").trim() || undefined;
    const genreProfileJsonForSubmit = genreKeyForSubmit ? genreJson : undefined;

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceName,
          timezone,
          postingTargets,
          personaProfileJson: personaJson,
          narratorProfileJson,
          genreKey: genreKeyForSubmit,
          genreProfileJson: genreProfileJsonForSubmit,
          sourceAccounts,
        }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setWorkspaceId(String(json.workspaceId));
      setResult("セットアップが完了しました。");
      setPolicyResult("");
      setSlotResult("");
      setStep("scheduling");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSchedulingPolicy() {
    if (!workspaceId) return;
    setPolicySaving(true);
    setPolicyResult("");
    try {
      const schedulingPolicy = {
        timezone,
        startDate: policyStartDate,
        endDate: policyEndDate,
        dailyPostLimit: {
          X: Math.max(0, Math.floor(Number(dailyLimitX) || 0)),
          THREADS: Math.max(0, Math.floor(Number(dailyLimitThreads) || 0)),
        },
        coreTimeWindows,
        minIntervalMinutes: Math.max(0, Math.floor(Number(minIntervalMinutes) || 0)),
        randomJitterMinutes: Math.max(0, Math.floor(Number(randomJitterMinutes) || 0)),
      };

      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/scheduling-policy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedulingPolicy }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setPolicyResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setPolicyResult("保存しました。");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setPolicyResult(`エラー: ${msg}`);
    } finally {
      setPolicySaving(false);
    }
  }

  async function generateSlots() {
    if (!workspaceId) return;
    setSlotGenerating(true);
    setSlotResult("");
    try {
      const res = await fetch("/api/scheduling/slots/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setSlotResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return null;
      }
      const created = Number(json.created ?? 0) || 0;
      const requested = Number(json.requested ?? 0) || 0;
      if (created === 0 && requested > 0) {
        setSlotResult(`投稿枠（投稿時間）は既に作成済みのようです（追加=0 / requested=${requested}）。`);
      } else {
        setSlotResult(`投稿枠（投稿時間）を生成しました: ${created} 件（requested=${requested}）`);
      }
      return { created, requested };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setSlotResult(`エラー: ${msg}`);
      return null;
    } finally {
      setSlotGenerating(false);
    }
  }

  function togglePostingTarget(p: Platform) {
    setPostingTargets((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function useSelectedWorkspace() {
    const id = String(selectedExistingWorkspaceId ?? "").trim();
    if (!id) return;
    setWorkspaceId(id);
    setResult("");
    setPolicyResult("");
    setSlotResult("");
    setStep("scheduling");
  }

  function toggleDay(windowIndex: number, day: number) {
    setCoreTimeWindows((prev) => {
      const next = [...prev];
      const w = next[windowIndex];
      if (!w) return prev;
      const has = w.daysOfWeek.includes(day);
      const daysOfWeek = has ? w.daysOfWeek.filter((d) => d !== day) : [...w.daysOfWeek, day].sort();
      next[windowIndex] = { ...w, daysOfWeek };
      return next;
    });
  }

  function updateWindow(windowIndex: number, patch: Partial<CoreTimeWindow>) {
    setCoreTimeWindows((prev) => {
      const next = [...prev];
      const w = next[windowIndex];
      if (!w) return prev;
      next[windowIndex] = { ...w, ...patch };
      return next;
    });
  }

  function addWindow() {
    setCoreTimeWindows((prev) => [...prev, { daysOfWeek: [1, 2, 3, 4, 5], startTime: "12:00", endTime: "13:00" }]);
  }

  function removeWindow(windowIndex: number) {
    setCoreTimeWindows((prev) => prev.filter((_, idx) => idx !== windowIndex));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">初期セットアップ</h1>
          <div className="mt-1 text-sm text-zinc-600">投稿設計の作成→投稿枠の生成までを1画面で進めます。</div>
        </div>
        <Link href="/postdrafts" className="spa-button-secondary">
          PostDraftへ
        </Link>
      </div>

      <div className="spa-card p-4 text-sm">
        <div className="font-medium">いまのステップ: {stepTitle(step)}</div>
        <div className="mt-1 text-xs text-zinc-600">すべて入力し終わったら確認画面で「セットアップを実行」できます。</div>
      </div>

      <Stepper steps={stepLabels} currentIndex={currentIndex} />

      {step === "workspace" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">投稿設計</div>
            {workspacesLoading ? <div className="text-xs text-zinc-600">読み込み中...</div> : null}
            {workspacesError ? <div className="text-xs text-red-700">{workspacesError}</div> : null}

            {workspaces.length > 0 ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useExistingWorkspace}
                    onChange={(e) => setUseExistingWorkspace(e.target.checked)}
                  />
                  既存の投稿設計を使う（おすすめ）
                </label>

                {useExistingWorkspace ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-sm font-medium">投稿設計を選択</div>
                      <select
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                        value={selectedExistingWorkspaceId}
                        onChange={(e) => setSelectedExistingWorkspaceId(e.target.value)}
                      >
                        {workspaces.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.id.slice(0, 8)}...)
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-end justify-end">
                      <button
                        className="spa-button-primary w-full disabled:opacity-50 md:w-auto"
                        disabled={!selectedExistingWorkspaceId.trim()}
                        onClick={useSelectedWorkspace}
                      >
                        この投稿設計で続ける
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!useExistingWorkspace ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-sm font-medium">投稿設計の名前</div>
                    <input
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-sm font-medium">タイムゾーン</div>
                    <input
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">投稿先（SNS / テスト用）</div>
                  <div className="flex gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={postingTargets.includes("X")}
                        onChange={() => togglePostingTarget("X")}
                      />
                      X（開発中）
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={postingTargets.includes("THREADS")}
                        onChange={() => togglePostingTarget("THREADS")}
                      />
                      Threads
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    className="spa-button-primary disabled:opacity-50"
                    disabled={!canGoNextWorkspace}
                    onClick={() => setStep("persona")}
                  >
                    次へ
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "persona" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">ペルソナ</div>
            <div className="text-xs text-zinc-600">
              誰に向けて書くか（対象/状況/悩み/理想/NG）をセットします。
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3">
              <div className="text-sm font-medium">ターゲット（audience）</div>
              <div className="text-xs text-zinc-600">誰に向けて書くか（対象/状況/悩み/理想/NG）をセットします。</div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <div className="text-xs text-zinc-700">対象（誰）</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={audienceWho}
                    onChange={(e) => setAudienceWho(e.target.value)}
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs text-zinc-700">理想（どうなりたい）</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={audienceDesired}
                    onChange={(e) => setAudienceDesired(e.target.value)}
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <div className="text-xs text-zinc-700">状況（いま）</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={audienceSituation}
                    onChange={(e) => setAudienceSituation(e.target.value)}
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <div className="text-xs text-zinc-700">悩み（困りごと）</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={audiencePain}
                    onChange={(e) => setAudiencePain(e.target.value)}
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <div className="text-xs text-zinc-700">NG（避けたいこと）</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={audienceNoGo}
                    onChange={(e) => setAudienceNoGo(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("workspace")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={
                  !audienceWho.trim() &&
                  !audienceDesired.trim() &&
                  !audienceSituation.trim() &&
                  !audiencePain.trim() &&
                  !audienceNoGo.trim()
                }
                onClick={() => setStep("narrator")}
              >
                次へ
              </button>
            </div>
          </div>
        ) : null}

        {step === "narrator" ? (
          <div className="spa-card p-6 space-y-4">
            <div className="text-sm font-medium">発信者プロフィール</div>
            <div className="text-xs text-zinc-600">
              「どういう立場の人が、どんな人間として発信しているか」を設定します。
              話し方（語尾・締め方）は投稿ごとに変えて良い前提です。
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-sm font-medium">立場（職種/役割など）</div>
                <input
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="例: 起業家 / エンジニア / 経営企画 / 個人開発者"
                  value={narratorRoleOrPosition}
                  onChange={(e) => setNarratorRoleOrPosition(e.target.value)}
                />
              </label>

              <label className="space-y-1">
                <div className="text-sm font-medium">性別</div>
                <select
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  value={narratorGender}
                  onChange={(e) => setNarratorGender(e.target.value as NarratorGender)}
                >
                  <option value="unspecified">指定しない</option>
                  <option value="female">女性</option>
                  <option value="male">男性</option>
                  <option value="other">その他</option>
                </select>
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-sm font-medium">人柄（性格/価値観）</div>
                <input
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="例: 誠実 / 実務派 / 率直 / 穏やか / 論理重視"
                  value={narratorPersonality}
                  onChange={(e) => setNarratorPersonality(e.target.value)}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-sm font-medium">背景（経歴/専門など）</div>
                <textarea
                  className="w-full min-h-[88px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="例: SaaSの開発を10年。PMも経験。個人でプロダクトも運用している。"
                  value={narratorBackground}
                  onChange={(e) => setNarratorBackground(e.target.value)}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-sm font-medium">自由文（補足）</div>
                <textarea
                  className="w-full min-h-[110px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="例: 読者は同業の実務者。煽りはしない。根拠のない断定は避ける。"
                  value={narratorNotes}
                  onChange={(e) => setNarratorNotes(e.target.value)}
                />
              </label>
            </div>

            {!canGoNextNarrator ? (
              <div className="text-xs text-red-700">立場か自由文のどちらかは入力してください。</div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("persona")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={!canGoNextNarrator}
                onClick={() => setStep("genre")}
              >
                次へ
              </button>
            </div>
          </div>
        ) : null}

        {step === "genre" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">フォーマット（任意）</div>
            <div className="text-xs text-zinc-600">投稿の「型」を選びます。不要なら「なし」でOKです。</div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-sm font-medium">フォーマット</div>
                <select
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  value={genreKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    setGenreKey(key);
                    if (!String(key).trim()) {
                      setGenreJson("{}");
                      return;
                    }
                    const preset = FORMAT_PRESETS.find((p) => p.key === key) ?? FORMAT_PRESETS[0];
                    setGenreJson(JSON.stringify(preset?.profile ?? {}, null, 2));
                  }}
                >
                  <option value="">なし</option>
                  {FORMAT_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {String(genreKey ?? "").trim() ? (
              <textarea
                className="w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                rows={10}
                value={genreJson}
                readOnly
              />
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("narrator")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={!canGoNextGenre}
                onClick={() => setStep("sources")}
              >
                次へ
              </button>
            </div>
          </div>
        ) : null}

        {step === "sources" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">参照アカウント</div>
            <div className="text-xs text-zinc-600">
              ここで指定したアカウントの投稿を、将来の学習/分析の入力として使う想定です（いまはテスト用）。
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700 space-y-1">
              <div className="font-medium">入力形式（1行=1アカウント）</div>
              <div className="font-mono">PLATFORM,handle,weight,memo</div>
              <div className="text-zinc-600">PLATFORM: X / THREADS（どっちのアカウントか）</div>
              <div className="text-zinc-600">handle: @から始まるID（例: @example）</div>
              <div className="text-zinc-600">weight: 重要度（数字が大きいほど優先して参考にします。空でもOK）</div>
              <div className="text-zinc-600">memo: その人っぽさ（文章の癖）を一言で（例: 結論→理由→一言 / 箇条書き多め / 短文テンポ / 問いかけで締める）</div>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs text-zinc-600">
                <div className="col-span-2">PLATFORM</div>
                <div className="col-span-3">handle</div>
                <div className="col-span-2">weight</div>
                <div className="col-span-4">memo</div>
                <div className="col-span-1"></div>
              </div>
              {sourceAccountRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <select
                    className="col-span-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={row.platform}
                    onChange={(e) => {
                      const v = e.target.value as Platform;
                      setSourceAccountRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, platform: v } : p)),
                      );
                    }}
                  >
                    <option value="X">X</option>
                    <option value="THREADS">THREADS</option>
                  </select>
                  <input
                    className="col-span-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={row.handle}
                    placeholder="@handle"
                    onChange={(e) => {
                      const v = e.target.value;
                      setSourceAccountRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, handle: v } : p)),
                      );
                    }}
                    onBlur={() => {
                      setSourceAccountRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, handle: normalizeHandle(p.handle) } : p)),
                      );
                    }}
                  />
                  <input
                    className="col-span-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    type="number"
                    value={row.weight ?? ""}
                    placeholder="(任意)"
                    onChange={(e) => {
                      const raw = e.target.value;
                      const num = raw === "" ? undefined : Number(raw);
                      const v = Number.isFinite(num as number) ? (num as number) : undefined;
                      setSourceAccountRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, weight: v } : p)),
                      );
                    }}
                  />
                  <input
                    className="col-span-4 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={row.memo ?? ""}
                    placeholder="例: 結論→理由→一言 / 箇条書き / 短文テンポ"
                    onChange={(e) => {
                      const v = e.target.value;
                      setSourceAccountRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, memo: v } : p)),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="col-span-1 spa-button-secondary"
                    onClick={() => {
                      setSourceAccountRows((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
              {sourceAccountRowErrors.some(Boolean) ? (
                <div className="text-xs text-red-700">
                  {sourceAccountRowErrors
                    .map((m, i) => (m ? `行${i + 1}: ${m}` : ""))
                    .filter(Boolean)
                    .slice(0, 5)
                    .join(" / ")}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-zinc-600">解析結果: {sourceAccounts.length} 件</div>
                <button
                  type="button"
                  className="spa-button-secondary"
                  onClick={() => {
                    setSourceAccountRows((prev) => [...prev, { platform: "X", handle: "", weight: undefined, memo: "" }]);
                  }}
                >
                  追加
                </button>
              </div>
            </div>
            {sourceAccounts.length === 0 ? (
              <div className="text-xs text-red-700">最低1件は入力してください。</div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("genre")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={!canGoNextSources}
                onClick={() => setStep("confirm")}
              >
                次へ
              </button>
            </div>
          </div>
        ) : null}

        {step === "confirm" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">確認</div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
              <div className="text-xs text-zinc-600">投稿設計の名前</div>
              <div className="font-medium">{workspaceName}</div>
              <div className="mt-2 text-xs text-zinc-600">タイムゾーン</div>
              <div className="font-medium">{timezone}</div>
              <div className="mt-2 text-xs text-zinc-600">投稿先（SNS）</div>
              <div className="font-medium">{postingTargets.join(", ")}</div>
              <div className="mt-2 text-xs text-zinc-600">語り手</div>
              <div className="font-medium">
                {narratorProfile.roleOrPosition || "(未入力)"}
                {narratorProfile.gender !== "unspecified" ? ` / ${narratorProfile.gender}` : ""}
              </div>
              <div className="mt-2 text-xs text-zinc-600">フォーマットキー</div>
              <div className="font-medium">{String(genreKey ?? "").trim() || "(なし)"}</div>
              <div className="mt-2 text-xs text-zinc-600">参照アカウント</div>
              <div className="font-medium">{sourceAccounts.length} 件</div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("sources")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={submitting || !canRun}
                onClick={submit}
              >
                {submitting ? "実行中..." : "セットアップを実行"}
              </button>
            </div>

            {!canRun ? (
              <div className="text-xs text-red-700">入力が不足しているため、実行できません。</div>
            ) : null}
          </div>
        ) : null}

        {step === "scheduling" && workspaceId ? (
          <div className="spa-card p-6 space-y-5">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold tracking-tight">投稿枠（スケジューリング）</div>
              <div className="text-xs text-zinc-600">
                入力する場所は「必須」カードに集約しました。まずはそこで保存→Slots生成まで進めればOKです。
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                className="spa-button-secondary px-3 py-1.5 text-xs"
                onClick={() => {
                  setUseExistingWorkspace(false);
                  setStep("workspace");
                }}
              >
                新しい投稿設計を作る
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">必須</div>
                  <div className="rounded-full bg-black px-2 py-0.5 text-[11px] font-medium text-white">
                    入力
                  </div>
                </div>
                <div className="text-xs text-zinc-600">最初はここだけでOK</div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">対象期間（開始）</div>
                    <div className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">必須</div>
                  </div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={policyStartDate}
                    onChange={(e) => setPolicyStartDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">対象期間（終了）</div>
                    <div className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">必須</div>
                  </div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={policyEndDate}
                    onChange={(e) => setPolicyEndDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                注意: 1日あたり上限は、Xは3件まで / Threadsは4件までを目安にしてください。
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">1日あたり上限（X）</div>
                    <div className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">必須</div>
                  </div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    type="number"
                    min={0}
                    value={dailyLimitX}
                    onChange={(e) => setDailyLimitX(Number(e.target.value))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">1日あたり上限（Threads）</div>
                    <div className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">必須</div>
                  </div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    type="number"
                    min={0}
                    value={dailyLimitThreads}
                    onChange={(e) => setDailyLimitThreads(Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">コアタイム（投稿枠）</div>
                    <div className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">必須</div>
                  </div>
                  <button
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-zinc-50"
                    onClick={addWindow}
                  >
                    追加
                  </button>
                </div>
                <div className="mt-1 text-xs text-zinc-600">曜日と時間帯を指定します（例: 平日 08:30-10:30）。</div>

                <div className="mt-3 space-y-3">
                  {coreTimeWindows.map((w, idx) => (
                    <div key={idx} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">枠 {idx + 1}</div>
                        {coreTimeWindows.length > 1 ? (
                          <button
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
                            onClick={() => removeWindow(idx)}
                          >
                            削除
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-3 text-sm">
                        {[
                          { d: 0, label: "日" },
                          { d: 1, label: "月" },
                          { d: 2, label: "火" },
                          { d: 3, label: "水" },
                          { d: 4, label: "木" },
                          { d: 5, label: "金" },
                          { d: 6, label: "土" },
                        ].map((it) => (
                          <label key={it.d} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={w.daysOfWeek.includes(it.d)}
                              onChange={() => toggleDay(idx, it.d)}
                            />
                            {it.label}
                          </label>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                          <div className="text-sm font-medium">開始（HH:MM）</div>
                          <input
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                            value={w.startTime}
                            onChange={(e) => updateWindow(idx, { startTime: e.target.value })}
                          />
                        </label>
                        <label className="space-y-2">
                          <div className="text-sm font-medium">終了（HH:MM）</div>
                          <input
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                            value={w.endTime}
                            onChange={(e) => updateWindow(idx, { endTime: e.target.value })}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">任意</div>
                <div className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                  後で調整
                </div>
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                まずはデフォルトのままでOK。運用しながら最適化します。
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">最小間隔（分）</div>
                    <div className="rounded bg-white px-2 py-0.5 text-[11px] text-zinc-700">任意</div>
                  </div>
                  <div className="text-xs text-zinc-600">投稿と投稿のあいだを最低でもこの分だけ空けます（例: 90分）。</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    type="number"
                    min={0}
                    value={minIntervalMinutes}
                    onChange={(e) => setMinIntervalMinutes(Number(e.target.value))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">ジッター（分）</div>
                    <div className="rounded bg-white px-2 py-0.5 text-[11px] text-zinc-700">任意</div>
                  </div>
                  <div className="text-xs text-zinc-600">投稿時間を少しだけランダムにずらします（例: 15分なら±15分の範囲で変動）。</div>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    type="number"
                    min={0}
                    value={randomJitterMinutes}
                    onChange={(e) => setRandomJitterMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={policySaving || slotGenerating}
                onClick={async () => {
                  await saveSchedulingPolicy();
                  const r = await generateSlots();
                  if (!r) return;
                  if (r.created <= 0 && r.requested <= 0) return;
                  router.push(`/postdrafts?workspaceId=${encodeURIComponent(workspaceId)}`);
                }}
              >
                {policySaving || slotGenerating ? "実行中..." : "保存して投稿枠を生成 → 大量生成へ"}
              </button>
            </div>

            {policyResult ? <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">{policyResult}</div> : null}
            {slotResult ? <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">{slotResult}</div> : null}
          </div>
        ) : null}

        {result ? <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">{result}</div> : null}
      </div>
  );
}
