"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Schedule = {
  id: string;
  draftId: string | null;
  postDraftId?: string | null;
  platform: "X" | "THREADS";
  scheduledAt: string;
  status: string;
  isConfirmed: boolean;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
  published?: {
    id: string;
    externalPostId: string | null;
    postedAt: string;
  } | null;
  draft?: {
    id: string;
    theme: string;
    status: string;
    workspaceId: string;
  } | null;
  postDraft?: {
    id: string;
    workspaceId: string;
    platform: "X" | "THREADS";
    status: string;
    body: string;
    tempScheduledAt: string | null;
    confirmedAt: string | null;
  } | null;
};

function isThreadsTokenExpiredErrorText(errorText: string) {
  const m = String(errorText ?? "").toLowerCase();
  return (
    m.includes("session has expired") ||
    m.includes("error validating access token") ||
    m.includes("oauth") && m.includes("expired") ||
    m.includes("threadsトークンの有効期限切れ")
  );
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>("");

  const [lastLoadedAtIso, setLastLoadedAtIso] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [showUpcomingOnly, setShowUpcomingOnly] = useState(true);

  const [cronSecretConfigured, setCronSecretConfigured] = useState<boolean | null>(null);

  const cronModeText = cronSecretConfigured
    ? "運用モード: Cronで自動処理（5分おき）"
    : "運用モード: 手動実行（開発/ローカル向け）";

  const [ticking, setTicking] = useState(false);
  const [tickResult, setTickResult] = useState<string>("");

  const [cancellingId, setCancellingId] = useState<string>("");
  const [cancelResult, setCancelResult] = useState<string>("");

  const [clearingFailed, setClearingFailed] = useState(false);
  const [clearFailedResult, setClearFailedResult] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    const workspaceId = String(params.get("workspaceId") ?? "").trim();
    setCurrentWorkspaceId(workspaceId);
    const url = workspaceId ? `/api/schedules?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/schedules";

    const res = await fetch(url);
    const json = (await res.json().catch(() => null)) as any;
    if (!json?.ok) {
      setError(String(json?.error ?? "読み込みに失敗しました"));
      setLoading(false);
      return;
    }

    setSchedules((json.schedules ?? []) as Schedule[]);
    setLastLoadedAtIso(new Date().toISOString());
    setLoading(false);
  }

  async function loadCronStatus() {
    try {
      const res = await fetch("/api/cron/status", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setCronSecretConfigured(null);
        return;
      }
      setCronSecretConfigured(Boolean(json.cronSecretConfigured));
    } catch {
      setCronSecretConfigured(null);
    }
  }

  useEffect(() => {
    loadCronStatus();
    load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void load();
    }, 10_000);
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  function isDue(s: Schedule) {
    if (s.status !== "waiting") return false;
    const effectiveConfirmed = Boolean(s.isConfirmed || s.draftId);
    if (!effectiveConfirmed) return false;
    return new Date(s.scheduledAt).getTime() <= Date.now();
  }

  function ymd(dt: string) {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatGroupTitle(key: string) {
    if (key === "unknown") return "日付不明";
    const d = new Date(`${key}T00:00:00`);
    if (Number.isNaN(d.getTime())) return key;
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const w = weekdays[d.getDay()] ?? "";
    return `${key} (${w})`;
  }

  const dueCount = schedules.filter((s) => isDue(s)).length;
  const waitingCount = schedules.filter((s) => s.status === "waiting").length;
  const postingCount = schedules.filter((s) => s.status === "posting").length;
  const postedCount = schedules.filter((s) => s.status === "posted").length;

  const visibleSchedules = useMemo(() => {
    // 「本日以降」を基準にフィルタする（ローカルタイムの0時）
    const todayThresholdMs = showUpcomingOnly
      ? (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })()
      : null;

    return schedules.filter((s) => {
      const effectiveConfirmed = Boolean(s.isConfirmed || s.draftId);
      if (!effectiveConfirmed) return false;
      if (s.status === "posted") return false;

      if (todayThresholdMs !== null) {
        const t = new Date(s.scheduledAt).getTime();
        if (Number.isFinite(t) && t < todayThresholdMs) return false;
      }

      // 常に waiting/posting/failed を表示（posted は上で除外済み）
      return s.status === "waiting" || s.status === "posting" || s.status === "failed";
    });
  }, [schedules, showUpcomingOnly]);

  const groupedVisibleSchedules = useMemo(() => {
    const groups = new Map<string, Schedule[]>();
    for (const s of visibleSchedules) {
      const key = ymd(s.scheduledAt) || "unknown";
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }

    const keys = Array.from(groups.keys());
    keys.sort((a, b) => {
      if (a === "unknown" && b === "unknown") return 0;
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return a.localeCompare(b);
    });

    return keys.map((k) => ({
      key: k,
      title: formatGroupTitle(k),
      items: (groups.get(k) ?? []).slice().sort((a, b) => {
        const ax = new Date(a.scheduledAt).getTime();
        const bx = new Date(b.scheduledAt).getTime();
        const aa = Number.isFinite(ax) ? ax : 0;
        const bb = Number.isFinite(bx) ? bx : 0;
        return aa - bb;
      }),
    }));
  }, [visibleSchedules]);

  const failedCount = schedules.filter((s) => s.status === "failed").length;

  const lastLoadedText = useMemo(() => {
    if (!lastLoadedAtIso) return "-";
    const t = new Date(lastLoadedAtIso);
    if (Number.isNaN(t.getTime())) return "-";
    return t.toLocaleString();
  }, [lastLoadedAtIso]);

  async function runTick() {
    setTicking(true);
    setTickResult("");
    try {
      const res = await fetch("/api/cron/tick?limit=20");
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        const rawError = String(json?.error ?? "不明なエラー");
        if (rawError === "Unauthorized" || res.status === 401) {
          setTickResult(
            "エラー: この環境ではCRON_SECRETが設定されているため、手動実行は無効です。VercelのCron Jobsから /api/cron/tick?secret=... を定期実行してください。",
          );
          return;
        }
        setTickResult(`エラー: ${rawError}`);
        return;
      }

      setTickResult(
        `結果: 対象=${json.found} / 成功=${json.processed} / 失敗=${json.failed}`,
      );
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setTickResult(`エラー: ${msg}`);
    } finally {
      setTicking(false);
    }
  }

  async function cancelSchedule(id: string) {
    setCancellingId(id);
    setCancelResult("");
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setCancelResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setCancelResult("予約を取り消しました。");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setCancelResult(`エラー: ${msg}`);
    } finally {
      setCancellingId("");
    }
  }

  async function clearFailedSchedules() {
    if (clearingFailed) return;
    if (failedCount === 0) return;

    const ok = window.confirm(`failed の予約を ${failedCount} 件削除します。よろしいですか？`);
    if (!ok) return;

    setClearingFailed(true);
    setClearFailedResult("");
    try {
      const res = await fetch("/api/schedules/failed", { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setClearFailedResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setClearFailedResult(`failed を ${Number(json.deleted ?? 0) || 0} 件削除しました。`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setClearFailedResult(`エラー: ${msg}`);
    } finally {
      setClearingFailed(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">予約</h1>
          <div className="mt-1 text-sm text-zinc-600">Threads / X の予約状況を確認し、必要に応じて手動実行やキャンセルを行います。</div>
          <div className="mt-1 text-xs text-zinc-500">
            {currentWorkspaceId
              ? <>対象 workspaceId: <span className="font-mono">{currentWorkspaceId}</span></>
              : "workspaceId が指定されていないため、全ワークスペースの予約が混在して表示されます（開発/デバッグ用）。"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-zinc-600">
          <div>{cronModeText}</div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            自動更新（10秒）
          </label>
        </div>
      </div>

      <div className="spa-card p-4">
        <div className="text-sm font-semibold">次のステップ</div>
        <div className="mt-1 text-xs text-zinc-600">投稿下書きを取り込み → 確定 → 予約、の順で進めます。</div>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <Link className="spa-button-primary text-center" href="/postdrafts">
            投稿案の作成へ
          </Link>
        </div>
      </div>

      <div className="spa-card p-4 text-sm text-zinc-700">
        確定済みの予約のみを一覧で確認できます。未確定（仮予約）や投稿済み履歴は表示しません。
      </div>

      <div className="spa-card p-4 text-sm">
          <div className="font-medium">{cronModeText}</div>
          {cronSecretConfigured ? (
            <div className="mt-1 text-xs text-zinc-600">
              本番運用では手動実行ボタンは使いません。VercelのCron Jobsで 5分おき（*/5 * * * *）に
              /api/cron/tick を実行してください（CRON_SECRET を設定すると、Vercelが Authorization: Bearer ... を自動で付けて呼び出します）。
            </div>
          ) : null}
          {cronSecretConfigured === null ? (
            <div className="mt-1 text-xs text-zinc-600">
              Cron設定の状態を取得できませんでした（/api/cron/status）。
            </div>
          ) : null}
        </div>

        <div className="spa-card p-4 text-sm">
          <div className="font-medium">いまのステップ: 予約を処理する</div>
          <div className="mt-1 text-xs text-zinc-600">処理対象（waiting かつ 予約日時が過去）: {dueCount} 件</div>
        </div>

        <div className="spa-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium">いまの状態（サマリー）</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
              <div>
                最終更新: <span className="font-medium text-zinc-800">{lastLoadedText}</span>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                自動更新（10秒）
              </label>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className={`rounded-lg border p-3 ${dueCount > 0 ? "border-amber-300 bg-amber-50" : "bg-white"}`}>
              <div className="text-xs text-zinc-600">処理対象</div>
              <div className={`mt-1 text-2xl font-semibold ${dueCount > 0 ? "text-amber-900" : "text-zinc-900"}`}>{dueCount}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-xs text-zinc-600">待機中</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-900">{waitingCount}</div>
            </div>
            <div className={`rounded-lg border p-3 ${postingCount > 0 ? "border-zinc-300 bg-zinc-50" : "bg-white"}`}>
              <div className="text-xs text-zinc-600">投稿中</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-900">{postingCount}</div>
            </div>
            <div className={`rounded-lg border p-3 ${failedCount > 0 ? "border-red-300 bg-red-50" : "bg-white"}`}>
              <div className="text-xs text-zinc-600">失敗</div>
              <div className={`mt-1 text-2xl font-semibold ${failedCount > 0 ? "text-red-700" : "text-zinc-900"}`}>{failedCount}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-xs text-zinc-600">投稿済み</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-900">{postedCount}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!cronSecretConfigured ? (
            <button
              className="spa-button-primary disabled:opacity-50"
              disabled={ticking || dueCount === 0}
              onClick={runTick}
            >
              {ticking ? "実行中..." : "予約を処理"}
            </button>
          ) : (
            <button className="spa-button-primary opacity-40" disabled>
              Cronで自動処理（手動無効）
            </button>
          )}
          {tickResult ? <div className="text-sm">{tickResult}</div> : null}
          {cancelResult ? <div className="text-sm">{cancelResult}</div> : null}
          {clearFailedResult ? <div className="text-sm">{clearFailedResult}</div> : null}
          <button className="spa-button-secondary" disabled={loading} onClick={load}>
            再読み込み
          </button>
        </div>

        <div className="spa-card flex items-center justify-between p-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="font-medium">表示</div>
            <div className="text-xs text-zinc-600">すべての予約（failed を含む）が表示されています。</div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={showUpcomingOnly}
                onChange={(e) => setShowUpcomingOnly(e.target.checked)}
              />
              本日以降の予約投稿のみ表示
            </label>
            <div className="flex items-center gap-2">
              <div className="text-xs text-zinc-600">failed: {failedCount} 件</div>
              <button
                className="spa-button-secondary disabled:opacity-50"
                disabled={clearingFailed || failedCount === 0}
                onClick={clearFailedSchedules}
              >
                {clearingFailed ? "failed削除中..." : "failedを一括削除"}
              </button>
            </div>
          </div>
        </div>

        {loading ? <div className="text-sm text-zinc-600">読み込み中...</div> : null}
        {error ? <div className="rounded border bg-white p-3 text-sm">{error}</div> : null}

        <div className="spa-card overflow-hidden">
          <div className="grid grid-cols-12 gap-2 border-b p-3 text-xs font-medium text-zinc-600">
            <div className="col-span-4">テーマ</div>
            <div className="col-span-2">投稿先</div>
            <div className="col-span-2">予約日時</div>
            <div className="col-span-2">状態</div>
            <div className="col-span-1">投稿済み</div>
            <div className="col-span-1">操作</div>
          </div>

          {groupedVisibleSchedules.flatMap((g) => {
            const headerRow = (
              <div
                key={`group-${g.key}`}
                className="mt-3 flex items-center gap-2 border-y border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold tracking-wide text-indigo-900"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white text-[11px] text-indigo-700">
                  📅
                </span>
                <span>{g.title}</span>
              </div>
            );

            const rows = g.items.map((s) => {
              const effectiveConfirmed = Boolean(s.isConfirmed || s.draftId);
              const due = isDue(s);
              const workspaceId = String(s.postDraft?.workspaceId ?? s.draft?.workspaceId ?? "").trim();
              const threadsReconnectHref = workspaceId
                ? `/threads/connect?workspaceId=${encodeURIComponent(workspaceId)}`
                : "/threads/connect";
              const showThreadsReconnect =
                s.platform === "THREADS" && Boolean(s.errorText) && isThreadsTokenExpiredErrorText(String(s.errorText ?? ""));
              const canCancel =
                s.status === "waiting" &&
                !s.published &&
                Boolean(s.postDraftId) &&
                !Boolean(s.draftId);

              const rowClass =
                due ? "bg-amber-50/70" : s.status === "posting" ? "bg-zinc-50/40" : "bg-white";

              return (
                <div key={s.id} className={`grid grid-cols-12 gap-2 border-b p-3 text-sm last:border-b-0 ${rowClass}`}>
                  <div className="col-span-4 break-words text-[13px] text-zinc-800">
                    {s.draft?.theme
                      ? s.draft.theme
                      : s.postDraft?.body
                        ? s.postDraft.body.slice(0, 60)
                        : "（内容なし）"}
                  </div>
                  <div className="col-span-2">{s.platform}</div>
                  <div className="col-span-2 text-sm font-semibold text-zinc-900">
                    {(() => {
                      const d = new Date(s.scheduledAt);
                      if (Number.isNaN(d.getTime())) return "-";
                      const hh = String(d.getHours()).padStart(2, "0");
                      const mm = String(d.getMinutes()).padStart(2, "0");
                      return `${hh}:${mm}`;
                    })()}
                  </div>
                  <div className="col-span-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {due ? (
                        <span className="inline-flex items-center rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                          due
                        </span>
                      ) : null}
                      <span
                        className={
                          s.status === "waiting"
                            ? "inline-flex items-center rounded-full bg-sky-500 px-2 py-0.5 text-[11px] font-semibold text-white" // 待機中
                            : s.status === "posting"
                              ? "inline-flex items-center rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white" // 投稿中
                              : s.status === "failed"
                                ? "inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white" // 失敗
                                : s.status === "posted"
                                  ? "inline-flex items-center rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white" // 投稿済み
                                  : "inline-flex items-center rounded-full bg-zinc-600 px-2 py-0.5 text-[11px] font-semibold text-white" // その他
                        }
                      >
                        {s.status === "waiting"
                          ? "待機中"
                          : s.status === "posting"
                            ? "投稿中"
                            : s.status === "failed"
                              ? "失敗"
                              : s.status === "posted"
                                ? "投稿済み"
                                : s.status}
                      </span>
                    </div>
                    {!effectiveConfirmed ? <div className="mt-1 text-xs text-zinc-600">（未確定）</div> : null}
                  </div>
                  <div className="col-span-1 text-sm font-semibold text-zinc-900">
                    {s.published
                      ? (() => {
                          const d = new Date(s.published!.postedAt);
                          if (Number.isNaN(d.getTime())) return "-";
                          const hh = String(d.getHours()).padStart(2, "0");
                          const mm = String(d.getMinutes()).padStart(2, "0");
                          return `${hh}:${mm}`;
                        })()
                      : "-"}
                  </div>
                  <div className="col-span-1">
                    {canCancel ? (
                      <button
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        disabled={Boolean(cancellingId)}
                        onClick={() => cancelSchedule(s.id)}
                      >
                        {cancellingId === s.id ? "取消中..." : "取消"}
                      </button>
                    ) : s.draftId ? (
                      <Link className="underline" href={`/drafts/${encodeURIComponent(s.draftId)}`}>
                        開く
                      </Link>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </div>
                  {s.errorText ? (
                    <div className="col-span-12 mt-2">
                      <details className="rounded border bg-white p-2 text-xs text-red-700">
                        <summary className="cursor-pointer select-none">エラー内容を表示</summary>
                        {showThreadsReconnect ? (
                          <div className="mt-2">
                            <div className="mb-2 text-xs text-zinc-700">
                              Threadsトークンの有効期限切れの可能性があります。投稿先を選んで再連携してください。
                            </div>
                            <Link
                              className="spa-button-primary"
                              href={threadsReconnectHref}
                            >
                              Threadsを再連携する
                            </Link>
                          </div>
                        ) : null}
                        <div className="mt-2 whitespace-pre-wrap">{s.errorText}</div>
                      </details>
                    </div>
                  ) : null}
                </div>
              );
            });

            return [headerRow, ...rows];
          })}

          {visibleSchedules.length === 0 ? (
            <div className="p-6 text-sm text-zinc-600">予約はまだありません。下書き詳細から予約を作成できます。</div>
          ) : null}
        </div>
    </div>
  );
}
