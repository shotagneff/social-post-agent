"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Platform = "X" | "THREADS";

type WorkspaceItem = {
  id: string;
  name: string;
  timezone: string;
  postingTargets?: Platform[];
};

type PostDraftItem = {
  id: string;
  workspaceId: string;
  platform: Platform;
  status: string;
  body: string;
  tempScheduledAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  slot: null | {
    id: string;
    scheduledAt: string;
    platform: Platform;
  };
};

type PostDraftDetail = {
  id: string;
  workspaceId: string;
  platform: Platform;
  status: string;
  body: string;
  threadReplies?: unknown;
  tempScheduledAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  slot: null | {
    id: string;
    scheduledAt: string;
    platform: Platform;
  };
  schedules: Array<{ id: string; scheduledAt: string; status: string; isConfirmed: boolean }>;
};

function fmt(dt: string | null) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString();
}

function ymd(dt: string | null) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function effectiveScheduledAt(it: PostDraftItem) {
  return it.tempScheduledAt || it.slot?.scheduledAt || null;
}

function ConfirmedBadge(props: { confirmedAt: string | null }) {
  const { confirmedAt } = props;
  if (!confirmedAt) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        未確定（投稿対象外）
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
      確定済み
    </span>
  );
}

function clip(text: string, n: number) {
  const t = String(text ?? "");
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function Stepper(props: { steps: string[]; currentIndex: number }) {
  const { steps, currentIndex } = props;
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
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
            <div key={`${idx}-${label}`} className={`flex items-center gap-2 ${textClass}`}>
              <div className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${circleClass}`}>
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

export default function PostDraftsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  const [workspaceIdFromQuery, setWorkspaceIdFromQuery] = useState<string>("");

  const [platform, setPlatform] = useState<Platform>("X");
  const [count, setCount] = useState<number>(30);
  const [theme, setTheme] = useState<string>("テーマ（仮）");

  const [testModeImmediate, setTestModeImmediate] = useState(false);

  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string>("");

  const [recentOnly, setRecentOnly] = useState(false);
  const [recentAfterIso, setRecentAfterIso] = useState<string>("");
  const [recentBaselineIds, setRecentBaselineIds] = useState<string[]>([]);

  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string>("");
  const [items, setItems] = useState<PostDraftItem[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailConfirming, setDetailConfirming] = useState(false);
  const [detailError, setDetailError] = useState<string>("");
  const [detail, setDetail] = useState<PostDraftDetail | null>(null);
  const [detailBody, setDetailBody] = useState<string>("");
  const [detailThreadReplies, setDetailThreadReplies] = useState<string[]>(["", "", "", ""]);
  const [detailNotice, setDetailNotice] = useState<string>("");

  const canRun = Boolean(workspaceId.trim());

  const selectedWorkspace = useMemo(() => {
    const id = String(workspaceId ?? "").trim();
    return workspaces.find((w) => w.id === id) ?? null;
  }, [workspaceId, workspaces]);

  const allowedPlatforms = useMemo<Platform[]>(() => {
    const raw = selectedWorkspace?.postingTargets;
    const list = Array.isArray(raw) ? raw.filter((p): p is Platform => p === "X" || p === "THREADS") : [];
    return list.length > 0 ? list : ["X", "THREADS"];
  }, [selectedWorkspace]);

  useEffect(() => {
    if (!allowedPlatforms.includes(platform)) {
      setPlatform(allowedPlatforms[0] ?? "X");
    }
  }, [allowedPlatforms, platform]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromQuery = String(q.get("workspaceId") ?? "").trim();
    if (fromQuery) setWorkspaceIdFromQuery(fromQuery);
  }, []);

  useEffect(() => {
    if (workspaceId.trim()) {
      window.localStorage.setItem("lastWorkspaceId", workspaceId.trim());
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId.trim()) {
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

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
        const next = String(workspaceIdFromQuery || list[0]?.id || "").trim();
        if (next) setWorkspaceId(next);
      })
      .catch((e) => {
        if (canceled) return;
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setWorkspacesError(`エラー: ${msg}`);
      })
      .finally(() => {
        if (canceled) return;
        setWorkspacesLoading(false);
      });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    if (!workspaceId.trim()) return;
    setListLoading(true);
    setListError("");
    try {
      const res = await fetch(`/api/postdrafts?workspaceId=${encodeURIComponent(workspaceId)}&take=100`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setListError(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setItems(Array.isArray(json.postDrafts) ? json.postDrafts : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setListError(`エラー: ${msg}`);
    } finally {
      setListLoading(false);
    }
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailSaving(false);
    setDetailConfirming(false);
    setDetailError("");
    setDetailNotice("");
    setDetail(null);
    setDetailBody("");
    setDetailThreadReplies(["", "", "", ""]);
    try {
      const res = await fetch(`/api/postdrafts/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setDetailError(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      const pd = json.postDraft as PostDraftDetail;
      setDetail(pd);
      setDetailBody(String(pd.body ?? ""));

      const repliesRaw = Array.isArray((pd as any)?.threadReplies) ? ((pd as any).threadReplies as any[]) : [];
      const replies = repliesRaw
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, 4);
      setDetailThreadReplies([
        replies[0] ?? "",
        replies[1] ?? "",
        replies[2] ?? "",
        replies[3] ?? "",
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setDetailError(`エラー: ${msg}`);
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveDetail() {
    if (!detail) return;
    setDetailSaving(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/postdrafts/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: detailBody,
          threadReplies:
            detail.platform === "THREADS"
              ? detailThreadReplies
                  .map((x) => String(x ?? "").trim())
                  .filter(Boolean)
                  .slice(0, 4)
              : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setDetailError(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      await openDetail(detail.id);
      await reload();
      setResult("保存しました。");
      setDetailNotice("保存しました。一覧にも反映されています。");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setDetailError(`エラー: ${msg}`);
    } finally {
      setDetailSaving(false);
    }
  }

  async function confirmDetail() {
    if (!detail) return;
    setDetailConfirming(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/postdrafts/${encodeURIComponent(detail.id)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setDetailError(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      await openDetail(detail.id);
      await reload();
      setResult("確定しました。");
      setDetailNotice("確定しました。ステータスが CONFIRMED になっていれば投稿対象です。");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setDetailError(`エラー: ${msg}`);
    } finally {
      setDetailConfirming(false);
    }
  }

  async function createAndTentativelySchedule() {
    if (!canRun) return;
    setWorking(true);
    setResult("");

    setRecentBaselineIds(items.map((x) => x.id));

    const startedAt = Date.now();
    const safetyMs = 5 * 60 * 1000;
    setRecentAfterIso(new Date(startedAt - safetyMs).toISOString());
    setRecentOnly(true);
    try {
      const res1 = await fetch("/api/postdrafts/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          platform,
          count,
          theme,
        }),
      });

      const json1 = (await res1.json().catch(() => null)) as any;
      if (!json1?.ok) {
        setResult(`エラー: ${json1?.error ?? "不明なエラー"}`);
        return;
      }

      const meta = json1?.meta as any;
      const sourcesActive = Number(meta?.counts?.sourcesActive ?? 0) || 0;
      const genLabel = meta?.generator === "openai" ? "OpenAI" : "モック";
      const genNote = meta?.generator === "openai"
        ? "本文はAIで生成されました"
        : "本文はモックで生成されました（AI失敗時など）";
      const llmError = meta?.llmError ? String(meta.llmError) : "";
      const reviewChangedCount = Number(meta?.review?.changedCount ?? 0) || 0;
      const reviewError = meta?.review?.error ? String(meta.review.error) : "";
      const themesUsed = Array.isArray(meta?.themesUsed) ? (meta.themesUsed as any[]) : [];
      const themesUsedLabel = themesUsed
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      const sourcesUsed = Array.isArray(meta?.sourcesUsed) ? (meta.sourcesUsed as any[]) : [];
      const sourcesUsedLabel = sourcesUsed
        .map((x) => {
          const h = String(x?.handle ?? "").trim();
          const c = Number(x?.count ?? 0) || 0;
          return h ? `${h}${c ? `(${c})` : ""}` : "";
        })
        .filter(Boolean)
        .slice(0, 5)
        .join(" / ");
      const styleApplied = Array.isArray(meta?.styleApplied) ? (meta.styleApplied as any[]) : [];
      const styleAppliedLabel = styleApplied
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" / ");
      const diag = meta?.used
        ? [
            "設定チェック（投稿文の精度に影響）",
            `- 本文生成: ${genLabel}（${genNote}）`,
            ...(themesUsedLabel ? [`- 今回のテーマ（5つ）\n${themesUsedLabel}`] : []),
            `- ペルソナ: ${meta.used.persona ? "設定済み" : "未設定（/setup で設定）"}`,
            `- ジャンル: ${meta.used.genre ? "設定済み" : "未設定（/setup で設定）"}`,
            `- 参照アカウント: ${meta.used.sources ? `有効 ${sourcesActive}件` : "未設定（/setup の参照アカウントを追加）"}`,
            ...(sourcesUsedLabel ? [`- 自動選択された参考アカウント: ${sourcesUsedLabel}`] : []),
            ...(styleAppliedLabel ? [`- 書き分けの狙い（参考）: ${styleAppliedLabel}`] : []),
            ...(meta?.generator === "openai" ? [`- 品質チェック: 修正 ${reviewChangedCount}件${reviewError ? "（一部失敗）" : ""}`] : []),
            ...(reviewError ? [`- 品質チェックエラー（参考）: ${reviewError}`] : []),
            ...(llmError ? [`- AIエラー（参考）: ${llmError}`] : []),
            "（入力は不要）参照アカウントは /setup の『参照アカウント』で登録します。memo 例:『結論→理由→一言』『箇条書き多め』『短文テンポ』『問いかけで締める』",
          ].join("\n")
        : "";

      const res2 = await fetch("/api/scheduling/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          platform,
          limit: Math.max(1, Math.min(200, Number(count) || 30)),
          minLeadMinutes: testModeImmediate ? 0 : undefined,
        }),
      });

      const json2 = (await res2.json().catch(() => null)) as any;
      if (!json2?.ok) {
        setResult(`エラー: ${json2?.error ?? "不明なエラー"}`);
        return;
      }

      const assigned = Number(json2.assigned ?? 0) || 0;
      const hint = typeof json2.hint === "string" ? json2.hint : "";
      const reason = typeof json2.reason === "string" ? json2.reason : "";
      if (assigned === 0) {
        setResult(`仮予約できませんでした（0件）。${hint || `reason=${reason || "unknown"}`}`);
        await reload();
        return;
      }

      setResult(
        `作成しました: ${json1.created ?? 0} 件 / 仮予約: ${assigned} 件${testModeImmediate ? "（テストモード: 直近OK）" : ""}${diag ? `\n${diag}` : ""}`,
      );
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setWorking(false);
    }
  }


  const tempCount = useMemo(
    () => items.filter((x) => x.status === "TEMP_SCHEDULED").length,
    [items],
  );

  const generatedCount = useMemo(
    () => items.filter((x) => x.status === "DRAFT_GENERATED").length,
    [items],
  );

  const confirmedCount = useMemo(
    () => items.filter((x) => x.status === "CONFIRMED").length,
    [items],
  );

  const visibleItems = useMemo(() => {
    if (!recentOnly) return items;

    const baseline = new Set(recentBaselineIds);
    if (baseline.size > 0) {
      return items.filter((it) => !baseline.has(it.id));
    }

    const after = String(recentAfterIso ?? "").trim();
    if (!after) return items;
    const afterMs = new Date(after).getTime();
    if (!Number.isFinite(afterMs)) return items;
    return items.filter((it) => {
      const t = new Date(it.createdAt).getTime();
      return Number.isFinite(t) && t >= afterMs;
    });
  }, [items, recentAfterIso, recentBaselineIds, recentOnly]);

  const visibleTempCount = useMemo(
    () => visibleItems.filter((x) => x.status === "TEMP_SCHEDULED").length,
    [visibleItems],
  );

  const visibleGeneratedCount = useMemo(
    () => visibleItems.filter((x) => x.status === "DRAFT_GENERATED").length,
    [visibleItems],
  );

  const visibleConfirmedCount = useMemo(
    () => visibleItems.filter((x) => x.status === "CONFIRMED").length,
    [visibleItems],
  );

  const groupedVisibleItems = useMemo(() => {
    const groups = new Map<string, PostDraftItem[]>();
    for (const it of visibleItems) {
      const key = ymd(effectiveScheduledAt(it)) || "unscheduled";
      const arr = groups.get(key);
      if (arr) arr.push(it);
      else groups.set(key, [it]);
    }

    const keys = Array.from(groups.keys());
    keys.sort((a, b) => {
      if (a === "unscheduled" && b === "unscheduled") return 0;
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return a.localeCompare(b);
    });

    return keys.map((k) => ({
      key: k,
      title: k === "unscheduled" ? "未予約" : k,
      items: (groups.get(k) ?? []).slice().sort((x, y) => {
        const ax = new Date(effectiveScheduledAt(x) || x.createdAt).getTime();
        const ay = new Date(effectiveScheduledAt(y) || y.createdAt).getTime();
        const bx = Number.isFinite(ax) ? ax : 0;
        const by = Number.isFinite(ay) ? ay : 0;
        return bx - by;
      }),
    }));
  }, [visibleItems]);

  const recentFilterNotice = useMemo(() => {
    if (!recentOnly) return "";
    if (!recentAfterIso.trim()) return "";
    if (items.length === 0) return "";
    if (visibleItems.length > 0) return "";
    return "「直近の実行分のみ表示」がONのため、一覧が0件になっています。表示を戻すにはチェックをOFFにしてください。";
  }, [items.length, recentAfterIso, recentOnly, visibleItems.length]);

  const recentFilterHiddenNotice = useMemo(() => {
    if (!recentOnly) return "";
    if (items.length === 0) return "";
    if (visibleItems.length === 0) return "";
    if (visibleTempCount > 0 || visibleConfirmedCount > 0) return "";
    if (tempCount === 0 && confirmedCount === 0) return "";
    return "「直近の実行分のみ表示」がONのため、既存の仮予約（TEMP_SCHEDULED）/確定（CONFIRMED）が隠れている可能性があります。今日の予定が見えない場合はチェックをOFFにしてください。";
  }, [confirmedCount, items.length, recentOnly, tempCount, visibleConfirmedCount, visibleItems.length, visibleTempCount]);

  const stepLabels = ["投稿枠を作る", "大量生成＆仮予約", "確認して確定", "投稿実行"];
  const currentStepIndex = confirmedCount > 0 ? 3 : tempCount > 0 ? 2 : 1;

  const detailIsDirty = useMemo(() => {
    if (!detail) return false;
    const bodyDirty = detailBody !== String(detail.body ?? "");
    const currentRepliesRaw = Array.isArray((detail as any)?.threadReplies) ? ((detail as any).threadReplies as any[]) : [];
    const currentReplies = currentRepliesRaw
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const uiReplies = detailThreadReplies
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const repliesDirty = detail.platform === "THREADS" && JSON.stringify(currentReplies) !== JSON.stringify(uiReplies);
    return bodyDirty || repliesDirty;
  }, [detail, detailBody, detailThreadReplies]);

  const confirmDisabledReason = useMemo(() => {
    if (!detail) return "";
    if (detailSaving) return "保存中のため確定できません。";
    if (detailConfirming) return "確定処理中です。";
    if (detailIsDirty) return "未保存の変更があります。保存してから確定してください。";
    if (detail.status === "CONFIRMED") return "この投稿はすでに確定済みです。";
    if (detail.status !== "TEMP_SCHEDULED") {
      return "まだ仮予約になっていません。先に『大量生成して仮予約を作成』を実行してください（投稿枠が無い場合は /setup で投稿枠を生成）。";
    }
    return "";
  }, [detail, detailConfirming, detailIsDirty, detailSaving]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">PostDraft</h1>
        <Link href="/schedules" className="text-sm underline">
          予約へ
        </Link>
      </div>

      <Stepper steps={stepLabels} currentIndex={currentStepIndex} />

      <div className="spa-card p-6 space-y-5">
          <div className="text-sm font-semibold">2. 大量生成＆仮予約（まずはここ）</div>
          <div className="text-xs text-zinc-600">
            ボタンは基本これ1つです。「大量生成→仮予約」まで自動で行い、その後に内容を見て確定します。
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={testModeImmediate}
              onChange={(e) => setTestModeImmediate(e.target.checked)}
              disabled={!canRun || working}
            />
            テストモード: 直近の仮予約も許可（minLeadMinutes=0）
          </label>

          {testModeImmediate ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              テストを早く回すためのモードです。本番運用ではOFF推奨です（直近すぎる枠は投稿処理に間に合わない可能性があります）。
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <div className="text-sm font-medium">投稿先</div>
              <select
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                disabled={workspacesLoading}
              >
                <option value="">選択してください</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}（{w.timezone}）
                  </option>
                ))}
              </select>
              {workspacesError ? <div className="text-xs text-red-700">{workspacesError}</div> : null}
              <div className="text-xs text-zinc-600">
                {workspaceId ? (
                  <span>
                    workspaceId: <span className="font-mono">{workspaceId}</span>
                  </span>
                ) : (
                  <span>
                    まだ投稿先が無い場合は <Link className="underline" href="/setup">/setup</Link> で作成してください。
                  </span>
                )}
              </div>
            </label>

            <label className="space-y-2">
              <div className="text-sm font-medium">プラットフォーム</div>
              <select
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                disabled={allowedPlatforms.length <= 1}
              >
                {allowedPlatforms.includes("X") ? <option value="X">X（開発中）</option> : null}
                {allowedPlatforms.includes("THREADS") ? <option value="THREADS">Threads</option> : null}
              </select>
            </label>

            <label className="space-y-2">
              <div className="text-sm font-medium">件数（1〜200）</div>
              <input
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </div>

          <label className="space-y-2">
            <div className="text-sm font-medium">テーマ（モック用）</div>
            <input
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </label>

          <div className="flex flex-col gap-2 md:flex-row">
            <button
              className="spa-button-primary disabled:opacity-50"
              disabled={!canRun || working}
              onClick={createAndTentativelySchedule}
            >
              {working ? "実行中..." : "大量生成して仮予約を作成"}
            </button>

            <button
              className="spa-button-secondary disabled:opacity-50"
              disabled={!canRun || listLoading}
              onClick={reload}
            >
              {listLoading ? "更新中..." : "一覧を更新"}
            </button>
          </div>
          {!canRun ? <div className="text-xs text-red-700">投稿先を選択してください。</div> : null}

          {result ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm whitespace-pre-wrap">
              {result}
            </div>
          ) : null}
      </div>

      <div className="spa-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">PostDraft一覧（最新100件）</div>
            <div className="mt-1 text-xs text-zinc-600">
              全件: {items.length} / 表示中: {visibleItems.length}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={recentOnly}
              onChange={(e) => setRecentOnly(e.target.checked)}
              disabled={!recentAfterIso.trim()}
            />
            直近の実行分のみ表示
          </label>
        </div>

          {recentFilterNotice ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div>{recentFilterNotice}</div>
              <button className="mt-2 rounded-lg border bg-white px-3 py-1.5 text-xs" onClick={() => setRecentOnly(false)}>
                フィルタをOFFにする
              </button>
            </div>
          ) : null}

          {recentFilterHiddenNotice ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div>{recentFilterHiddenNotice}</div>
              <button className="mt-2 rounded-lg border bg-white px-3 py-1.5 text-xs" onClick={() => setRecentOnly(false)}>
                フィルタをOFFにする
              </button>
            </div>
          ) : null}

          {listError ? <div className="rounded border bg-white p-3 text-sm">{listError}</div> : null}

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-700">
                <tr>
                  <th className="px-3 py-2 text-left">Platform</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">予定（仮予約）</th>
                  <th className="px-3 py-2 text-left">確定</th>
                  <th className="px-3 py-2 text-left">本文</th>
                  <th className="px-3 py-2 text-left">操作</th>
                  <th className="px-3 py-2 text-left">ID</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-600" colSpan={7}>
                      まだありません。上の「大量生成して仮予約を作成」を押してください。
                    </td>
                  </tr>
                ) : (
                  groupedVisibleItems.flatMap((g) => {
                    const headerRow = (
                      <tr key={`group-${g.key}`} className="border-t bg-zinc-50/60">
                        <td className="px-3 py-2 text-xs font-semibold text-zinc-700" colSpan={7}>
                          {g.title}
                        </td>
                      </tr>
                    );

                    const rows = g.items.map((it) => {
                      const isWaitingLike = it.status === "CONFIRMED";
                      const rowClass = isWaitingLike
                        ? "border-t bg-emerald-50/70"
                        : it.status === "TEMP_SCHEDULED"
                          ? "border-t bg-white"
                          : "border-t";

                      return (
                        <tr key={it.id} className={rowClass}>
                          <td className="px-3 py-2 font-medium">{it.platform}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {isWaitingLike ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                  waiting
                                </span>
                              ) : null}
                              <span className={isWaitingLike ? "font-semibold text-emerald-900" : ""}>{it.status}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">{fmt(effectiveScheduledAt(it))}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1">
                              <ConfirmedBadge confirmedAt={it.confirmedAt} />
                              <span className={it.confirmedAt ? "text-xs text-zinc-700" : "text-xs text-amber-900"}>
                                {it.confirmedAt ? fmt(it.confirmedAt) : "-"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-zinc-700">{clip(it.body, 80)}</td>
                          <td className="px-3 py-2">
                            <button
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                              disabled={working}
                              onClick={() => openDetail(it.id)}
                            >
                              開く
                            </button>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-700">{it.id}</td>
                        </tr>
                      );
                    });

                    return [headerRow, ...rows];
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-zinc-600">
            行の「開く」で全文を確認・編集してから確定できます。確定したものだけが投稿対象になります（cronは確定済みのみ処理）。
          </div>
        </div>

        {detailOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailOpen(false)}>
            <div
              className="w-full max-w-3xl rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b p-4">
                <div>
                  <div className="text-sm font-semibold">PostDraft 詳細</div>
                  {detail ? (
                    <div className="mt-1 text-xs text-zinc-600">
                      {detail.platform} / {detail.status} / 仮予約: {fmt(detail.tempScheduledAt)}
                    </div>
                  ) : null}
                </div>
                <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50" onClick={() => setDetailOpen(false)}>
                  閉じる
                </button>
              </div>

              <div className="p-4 space-y-4" style={{ maxHeight: "calc(100vh - 8rem)", overflowY: "auto" }}>
                {detailLoading ? <div className="text-sm text-zinc-600">読み込み中...</div> : null}
                {detailError ? <div className="rounded-xl border bg-white p-3 text-sm">{detailError}</div> : null}

                {detail ? (
                  <>
                    <div className="rounded-xl border bg-zinc-50/60 p-3 text-xs text-zinc-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-500">ステータス:</span>
                        <span
                          className={
                            detail.status === "CONFIRMED"
                              ? "rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white"
                              : detail.status === "TEMP_SCHEDULED"
                                ? "rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white"
                                : "rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700"
                          }
                        >
                          {detail.status}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">ID:</span> <span className="font-mono">{detail.id}</span>
                      </div>
                      <div className="mt-1">
                        <span className="text-zinc-500">workspaceId:</span> <span className="font-mono">{detail.workspaceId}</span>
                      </div>
                      <div className="mt-1">
                        <span className="text-zinc-500">仮予約:</span> {fmt(detail.tempScheduledAt)}
                      </div>
                      <div className="mt-1">
                        <span className="text-zinc-500">確定:</span>{" "}
                        <span className={detail.confirmedAt ? "text-zinc-800" : "text-amber-900"}>
                          {detail.confirmedAt ? fmt(detail.confirmedAt) : "未確定（投稿対象外）"}
                        </span>
                      </div>
                    </div>

                    {detail.status === "CONFIRMED" && !detail.confirmedAt ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                        ステータスは CONFIRMED ですが、確定日時が空です。データ不整合の可能性があります（再読み込みしても直らない場合は教えてください）。
                      </div>
                    ) : null}

                    {detail.status !== "CONFIRMED" ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        未確定のものは投稿対象になりません。内容を確認して問題なければ「確定」を押してください。
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <div className="text-sm font-medium">本文（確認・編集）</div>
                      <textarea
                        className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                        rows={8}
                        value={detailBody}
                        onChange={(e) => setDetailBody(e.target.value)}
                      />
                    </div>

                    {detail.platform === "THREADS" ? (
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium">スレッド返信（任意 / 最大4つ）</div>
                          <div className="mt-1 text-xs text-zinc-600">
                            保存すると、本文→返信1→返信2→返信3→返信4 の順で返信チェーンとして投稿されます。空欄の返信は無視されます。
                          </div>
                          <div className="mt-1 text-xs text-zinc-600">目安: 各返信は 900 文字以内</div>
                        </div>

                        {detailThreadReplies.map((val, idx) => (
                          <label key={`thread-reply-${idx}`} className="space-y-2 block">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium text-zinc-700">返信 {idx + 1}</div>
                              <div className={String(val ?? "").length > 900 ? "text-xs text-red-700" : "text-xs text-zinc-500"}>
                                {String(val ?? "").length}/900
                              </div>
                            </div>
                            <textarea
                              className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                              rows={4}
                              value={val}
                              onChange={(e) => {
                                const next = detailThreadReplies.slice();
                                next[idx] = e.target.value;
                                setDetailThreadReplies(next);
                              }}
                            />
                            {String(val ?? "").length > 900 ? (
                              <div className="text-xs text-red-700">900文字を超えています（投稿に失敗する可能性があります）。</div>
                            ) : null}
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {confirmDisabledReason ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        {confirmDisabledReason}
                      </div>
                    ) : null}

                    {detailNotice ? (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-900">
                        {detailNotice}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="text-xs text-zinc-600">
                        未保存の変更がある場合は確定できません。必ず「保存」してから「確定」を押してください。
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row">
                        <button
                          className="spa-button-secondary disabled:opacity-50"
                          disabled={detailSaving || detailConfirming}
                          onClick={saveDetail}
                        >
                          {detailSaving ? "保存中..." : "保存"}
                        </button>
                        <button
                          className="spa-button-primary disabled:opacity-50"
                          disabled={Boolean(confirmDisabledReason)}
                          onClick={confirmDetail}
                        >
                          {detail.status === "CONFIRMED" ? "確定済み" : detailConfirming ? "確定中..." : "確定"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
    </div>
  );
}
