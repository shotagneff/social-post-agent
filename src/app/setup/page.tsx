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
  | "genre"
  | "sources"
  | "confirm"
  | "scheduling";

function stepTitle(step: SetupStep) {
  switch (step) {
    case "workspace":
      return "1. 投稿先";
    case "persona":
      return "2. ペルソナ";
    case "genre":
      return "3. ジャンル";
    case "sources":
      return "4. 参照アカウント";
    case "confirm":
      return "5. 確認";
    case "scheduling":
      return "6. 投稿枠（スケジューリング）";
  }
}

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
  const [workspaceName, setWorkspaceName] = useState("マイ投稿先");
  const [timezone, setTimezone] = useState("Asia/Tokyo");
  const [postingTargets, setPostingTargets] = useState<Platform[]>(["X"]);

  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  const [useExistingWorkspace, setUseExistingWorkspace] = useState<boolean>(false);
  const [selectedExistingWorkspaceId, setSelectedExistingWorkspaceId] = useState<string>("");

  const [personaJson, setPersonaJson] = useState(
    JSON.stringify(
      {
        position: "",
        experience: "",
        beliefs: [],
        tone: { assertiveness: 0.6, empathy: 0.6 },
        banned_expressions: [],
        allowed_expressions: [],
        version: 1,
      },
      null,
      2,
    ),
  );

  const [genreKey, setGenreKey] = useState("job-hunt");
  const [genreJson, setGenreJson] = useState(
    JSON.stringify(
      {
        audience: "",
        style_guide: { structure: "", cta: "" },
        output_formats: { X: {}, THREADS: {} },
        banned_topics: [],
        banned_claims: [],
      },
      null,
      2,
    ),
  );

  const [sourceAccountsText, setSourceAccountsText] = useState(
    "X,@example1,3,結論→理由→一言で締める\nX,@example2,1,箇条書き多めで短文テンポ\nTHREADS,@example3,2,問いかけで締める",
  );

  const sourceAccounts = useMemo<SourceAccount[]>(() => {
    return sourceAccountsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [platformRaw, handleRaw, weightRaw, ...memoParts] = line.split(",");
        const platform = (platformRaw ?? "").trim().toUpperCase();
        const handle = (handleRaw ?? "").trim();
        const weightNum = Number(String(weightRaw ?? "").trim());
        const weight = Number.isFinite(weightNum) ? weightNum : undefined;
        const memo = memoParts.join(",").trim() || undefined;
        if ((platform === "X" || platform === "THREADS") && handle) {
          return { platform: platform as Platform, handle, weight, memo };
        }
        return null;
      })
      .filter((v): v is SourceAccount => Boolean(v));
  }, [sourceAccountsText]);

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

  const personaJsonValid = useMemo(() => {
    try {
      JSON.parse(personaJson);
      return true;
    } catch {
      return false;
    }
  }, [personaJson]);

  const genreJsonValid = useMemo(() => {
    try {
      JSON.parse(genreJson);
      return true;
    } catch {
      return false;
    }
  }, [genreJson]);

  const canGoNextWorkspace = Boolean(workspaceName.trim() && timezone.trim());
  const canGoNextPersona = personaJsonValid;
  const canGoNextGenre = Boolean(genreKey.trim() && genreJsonValid);
  const canGoNextSources = sourceAccounts.length > 0;
  const canRun = canGoNextWorkspace && canGoNextPersona && canGoNextGenre && canGoNextSources;

  const stepOrder: SetupStep[] = [
    "workspace",
    "persona",
    "genre",
    "sources",
    "confirm",
    "scheduling",
  ];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  const stepLabels = [
    "投稿先",
    "ペルソナ",
    "ジャンル",
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
          setResult(`選択中: workspaceId=${initial}`);
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
    setResult(`選択中: workspaceId=${id}`);
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
          personaProfileJson: personaJson,
          genreKey,
          genreProfileJson: genreJson,
          sourceAccounts,
        }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setWorkspaceId(String(json.workspaceId));
      setResult(`完了: workspaceId=${json.workspaceId}`);
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
    setResult(`選択中: workspaceId=${id}`);
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
          <div className="mt-1 text-sm text-zinc-600">投稿先の作成→投稿枠の生成までを1画面で進めます。</div>
        </div>
        <Link href="/postdrafts" className="spa-button-secondary">
          PostDraftへ
        </Link>
      </div>

      <div className="spa-card p-4 text-sm text-zinc-700">
        まずは投稿先を作成します。完了したら /threads/connect で連携し、/postdrafts で投稿案を作成→確定へ進みます。
      </div>

      <div className="spa-card p-4 text-sm">
        <div className="font-medium">いまのステップ: {stepTitle(step)}</div>
        <div className="mt-1 text-xs text-zinc-600">すべて入力し終わったら確認画面で「セットアップを実行」できます。</div>
      </div>

      <Stepper steps={stepLabels} currentIndex={currentIndex} />

      {step === "workspace" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">投稿先</div>
            {workspacesLoading ? <div className="text-xs text-zinc-600">読み込み中...</div> : null}
            {workspacesError ? <div className="text-xs text-red-700">{workspacesError}</div> : null}

            {workspaceId.trim() ? (
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-xs text-zinc-700">
                  選択中: <span className="font-mono">{workspaceId}</span>
                </div>
                <button className="spa-button-secondary" onClick={() => setStep("scheduling")}>
                  投稿枠（ステップ6）へ
                </button>
              </div>
            ) : null}

            {workspaces.length > 0 ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useExistingWorkspace}
                    onChange={(e) => setUseExistingWorkspace(e.target.checked)}
                  />
                  既存の投稿先を使う（おすすめ）
                </label>

                {useExistingWorkspace ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-sm font-medium">投稿先を選択</div>
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
                        この投稿先で続ける
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
                    <div className="text-sm font-medium">投稿先の名前</div>
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
                  <div className="text-sm font-medium">投稿先（テスト用）</div>
                  <div className="flex gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={postingTargets.includes("X")}
                        onChange={() => togglePostingTarget("X")}
                      />
                      X
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
            <div className="text-sm font-medium">ペルソナ（JSON）</div>
            <div className="text-xs text-zinc-600">
              投稿文の口調・前提・NG表現などを設定します（まずは空のままでOK）。
            </div>
            <textarea
              className="w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              rows={12}
              value={personaJson}
              onChange={(e) => setPersonaJson(e.target.value)}
            />
            {!personaJsonValid ? (
              <div className="text-xs text-red-700">JSONの形式が正しくありません。</div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("workspace")}>
                戻る
              </button>
              <button
                className="spa-button-primary disabled:opacity-50"
                disabled={!canGoNextPersona}
                onClick={() => setStep("genre")}
              >
                次へ
              </button>
            </div>
          </div>
        ) : null}

        {step === "genre" ? (
          <div className="spa-card p-6 space-y-3">
            <div className="text-sm font-medium">ジャンル（JSON）</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-sm font-medium">ジャンルキー</div>
                <input
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  value={genreKey}
                  onChange={(e) => setGenreKey(e.target.value)}
                />
              </label>
            </div>
            <textarea
              className="w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              rows={12}
              value={genreJson}
              onChange={(e) => setGenreJson(e.target.value)}
            />
            {!genreJsonValid ? (
              <div className="text-xs text-red-700">JSONの形式が正しくありません。</div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <button className="spa-button-secondary" onClick={() => setStep("persona")}>
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
              <div className="text-zinc-600">memo は「書き分けたい癖」を短く書くと効きます。</div>
              <div className="text-zinc-600">例: 『結論→理由→一言』『箇条書き多め』『短文テンポ』『問いかけで締める』</div>
              <div className="text-zinc-600">weight は優先度（大きいほど参照されやすい）です。空でもOK。</div>
            </div>
            <textarea
              className="w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              rows={6}
              value={sourceAccountsText}
              onChange={(e) => setSourceAccountsText(e.target.value)}
            />
            <div className="text-xs text-zinc-600">解析結果: {sourceAccounts.length} 件</div>
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
              <div className="text-xs text-zinc-600">投稿先の名前</div>
              <div className="font-medium">{workspaceName}</div>
              <div className="mt-2 text-xs text-zinc-600">タイムゾーン</div>
              <div className="font-medium">{timezone}</div>
              <div className="mt-2 text-xs text-zinc-600">投稿先</div>
              <div className="font-medium">{postingTargets.join(", ")}</div>
              <div className="mt-2 text-xs text-zinc-600">ジャンルキー</div>
              <div className="font-medium">{genreKey}</div>
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
                新しい投稿先を作る
              </button>
            </div>

            <div className="rounded-xl border bg-zinc-50/60 p-3 text-sm">
              <div className="text-xs text-zinc-600">workspaceId（表示のみ）</div>
              <div className="mt-1 font-mono text-xs text-zinc-800">{workspaceId}</div>
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
