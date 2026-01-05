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
  timezone?: string;
  postingTargets?: Platform[];
};

type SetupStep =
  | "workspace"
  | "scheduling";

function stepTitle(step: SetupStep) {
  switch (step) {
    case "workspace":
      return "1. 投稿先";
    case "scheduling":
      return "2. 投稿枠（スケジューリング）";
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
  const [workspaceName, setWorkspaceName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tokyo");
  const [postingTargets, setPostingTargets] = useState<Platform[]>(["THREADS"]);

  const [existingPostingTargets, setExistingPostingTargets] = useState<Platform[]>(["X", "THREADS"]);
  const [existingTargetsSaving, setExistingTargetsSaving] = useState(false);
  const [existingTargetsError, setExistingTargetsError] = useState<string>("");
  const [existingTargetsNotice, setExistingTargetsNotice] = useState<string>("");

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
  const [dailyLimitX, setDailyLimitX] = useState<number>(3);
  const [dailyLimitThreads, setDailyLimitThreads] = useState<number>(3);
  const [minIntervalMinutes, setMinIntervalMinutes] = useState<number>(90);
  const [randomJitterMinutes, setRandomJitterMinutes] = useState<number>(15);
  const [coreTimeWindows, setCoreTimeWindows] = useState<CoreTimeWindow[]>([
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "08:30", endTime: "21:00" },
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
  const canRun = canGoNextWorkspace;

  const preferredPlatformForLink: Platform | null = useMemo(() => {
    if (postingTargets.includes("THREADS")) return "THREADS";
    if (postingTargets.includes("X")) return "X";
    return null;
  }, [postingTargets]);

  const stepOrder: SetupStep[] = ["workspace", "scheduling"];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  const stepLabels = ["投稿先", "投稿枠"];

  useEffect(() => {
    function applyForcedStep() {
      if (typeof window === "undefined") return;
      const forced = String(new URLSearchParams(window.location.search).get("step") ?? "").trim();
      if (!forced) return;
      if (
        forced === "workspace" ||
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
    const w = workspaces.find((x) => x.id === id) ?? null;
    const raw = w?.postingTargets;
    const nextTargets = Array.isArray(raw) ? raw.filter((p): p is Platform => p === "X" || p === "THREADS") : [];
    setExistingPostingTargets(nextTargets.length > 0 ? nextTargets : ["X", "THREADS"]);
    setExistingTargetsError("");
    setExistingTargetsNotice("");
    setResult("");
    setPolicyResult("");
    setSlotResult("");
  }, [selectedExistingWorkspaceId, step, useExistingWorkspace]);

  async function submit() {
    setSubmitting(true);
    setResult("");

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceName,
          timezone,
          postingTargets,
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
          X: Math.min(5, Math.max(0, Math.floor(Number(dailyLimitX) || 0))),
          THREADS: Math.min(5, Math.max(0, Math.floor(Number(dailyLimitThreads) || 0))),
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
    // 投稿先は X / Threads のどちらか一つだけ選べるようにする
    setPostingTargets([p]);
  }

  function toggleExistingPostingTarget(p: Platform) {
    // 既存ワークスペースも投稿先は一つだけに制限する
    setExistingPostingTargets([p]);
  }

  async function saveExistingPostingTargets() {
    const id = String(selectedExistingWorkspaceId ?? "").trim();
    if (!id) return;

    setExistingTargetsSaving(true);
    setExistingTargetsError("");
    setExistingTargetsNotice("");
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/posting-targets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingTargets: existingPostingTargets }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setExistingTargetsError(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setExistingTargetsNotice("保存しました。/postdrafts に反映されます。");

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id ? { ...w, postingTargets: json.postingTargets ?? existingPostingTargets } : w)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setExistingTargetsError(`エラー: ${msg}`);
    } finally {
      setExistingTargetsSaving(false);
    }
  }

  function useSelectedWorkspace() {
    const id = String(selectedExistingWorkspaceId ?? "").trim();
    if (!id) return;
    setWorkspaceId(id);
    const w = workspaces.find((x) => x.id === id) ?? null;
    const raw = w?.postingTargets;
    const nextTargets = Array.isArray(raw) ? raw.filter((p): p is Platform => p === "X" || p === "THREADS") : [];
    setExistingPostingTargets(nextTargets.length > 0 ? nextTargets : ["X", "THREADS"]);
    setExistingTargetsError("");
    setExistingTargetsNotice("");
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
          <h1 className="text-2xl font-semibold">予約投稿の設定</h1>
          <div className="mt-1 text-sm text-zinc-600">投稿先の作成/選択と、投稿枠（コアタイム等）の設定を行います。</div>
        </div>
        <Link
          href={
            workspaceId
              ? `/postdrafts?workspaceId=${encodeURIComponent(workspaceId)}${
                  preferredPlatformForLink ? `&platform=${preferredPlatformForLink}` : ""
                }`
              : "/postdrafts"
          }
          className="spa-button-secondary"
        >
          投稿下書きへ
        </Link>
      </div>

      <div className="spa-card p-4 text-sm">
        <div className="font-medium">いまのステップ: {stepTitle(step)}</div>
        <div className="mt-1 text-xs text-zinc-600">投稿枠を生成したら /postdrafts で下書きを取り込んで確定していきます。</div>
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

                {useExistingWorkspace ? (
                  <div className="mt-4 space-y-3 rounded-2xl border bg-white p-4">
                    <div className="text-sm font-medium">投稿先（SNS）</div>
                    <div className="flex gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={existingPostingTargets.includes("X")}
                          onChange={() => toggleExistingPostingTarget("X")}
                          disabled={existingTargetsSaving}
                        />
                        X（開発中）
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={existingPostingTargets.includes("THREADS")}
                          onChange={() => toggleExistingPostingTarget("THREADS")}
                          disabled={existingTargetsSaving}
                        />
                        Threads
                      </label>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="spa-button-secondary disabled:opacity-50"
                        disabled={existingTargetsSaving || existingPostingTargets.length === 0 || !selectedExistingWorkspaceId.trim()}
                        onClick={saveExistingPostingTargets}
                      >
                        {existingTargetsSaving ? "保存中..." : "保存"}
                      </button>
                    </div>
                    {existingTargetsError ? <div className="text-xs text-red-700">{existingTargetsError}</div> : null}
                    {existingTargetsNotice ? <div className="text-xs text-emerald-700">{existingTargetsNotice}</div> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!useExistingWorkspace ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-sm font-medium">使用するアカウントのユーザー名</div>
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
                    disabled={submitting || !canGoNextWorkspace}
                    onClick={submit}
                  >
                    {submitting ? "作成中..." : "作成して次へ"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "scheduling" && workspaceId ? (
          <div className="spa-card p-6 space-y-5">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold tracking-tight">投稿枠（スケジューリング）</div>
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
                注意: 1日あたり上限は、X / Threads ともに3件までを目安にしてください。
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
                    max={5}
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
                    max={5}
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
                className="spa-button-secondary disabled:opacity-50"
                disabled={policySaving || slotGenerating}
                onClick={() => {
                  const preferred = postingTargets.includes("X")
                    ? "X"
                    : postingTargets.includes("THREADS")
                      ? "THREADS"
                      : "X";
                  router.push(`/postdrafts?workspaceId=${encodeURIComponent(workspaceId)}&platform=${preferred}`);
                }}
              >
                投稿下書きへ進む
              </button>

              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={policySaving || slotGenerating}
                onClick={async () => {
                  await saveSchedulingPolicy();
                  const r = await generateSlots();
                  if (!r) return;

                  if (r.requested <= 0) {
                    setSlotResult("投稿枠の生成数が 0 になりました（requested=0）。1日あたり上限や対象期間を見直してください。");
                  }

                  const preferred = postingTargets.includes("X")
                    ? "X"
                    : postingTargets.includes("THREADS")
                      ? "THREADS"
                      : "X";
                  router.push(`/postdrafts?workspaceId=${encodeURIComponent(workspaceId)}&platform=${preferred}`);
                }}
              >
                {policySaving || slotGenerating ? "実行中..." : "保存して投稿枠を生成 → 投稿下書きへ"}
              </button>
            </div>

            {policyResult ? <div className="text-sm text-zinc-700">{policyResult}</div> : null}
            {slotResult ? <div className="text-sm text-zinc-700">{slotResult}</div> : null}
          </div>
        ) : null}
    </div>
  );
}
