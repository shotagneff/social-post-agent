"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [ticking, setTicking] = useState(false);
  const [tickResult, setTickResult] = useState<string>("");

  const [cancellingId, setCancellingId] = useState<string>("");
  const [cancelResult, setCancelResult] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/schedules");
    const json = (await res.json().catch(() => null)) as any;
    if (!json?.ok) {
      setError(String(json?.error ?? "読み込みに失敗しました"));
      setLoading(false);
      return;
    }

    setSchedules((json.schedules ?? []) as Schedule[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const dueCount = schedules.filter((s) => {
    if (s.status !== "waiting") return false;
    const effectiveConfirmed = Boolean(s.isConfirmed || s.draftId);
    if (!effectiveConfirmed) return false;
    return new Date(s.scheduledAt).getTime() <= Date.now();
  }).length;

  async function runTick() {
    setTicking(true);
    setTickResult("");
    try {
      const res = await fetch("/api/cron/tick?limit=20");
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setTickResult(`エラー: ${json?.error ?? "不明なエラー"}`);
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

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">予約一覧</h1>
          <div className="flex gap-3 text-sm">
            <Link className="underline" href="/drafts">
              下書き
            </Link>
            <Link className="underline" href="/setup">
              セットアップ
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm text-zinc-700">
          下書きから作成した予約を一覧で確認できます。「予約を処理」を押すと、期限が過ぎた予約を投稿済みに進めます（いまはダミー投稿です）。
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="font-medium">いまのステップ: 予約を処理する</div>
          <div className="mt-1 text-xs text-zinc-600">処理対象（waiting かつ 予約日時が過去）: {dueCount} 件</div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={ticking || dueCount === 0}
            onClick={runTick}
          >
            {ticking ? "実行中..." : "予約を処理"}
          </button>
          {tickResult ? <div className="text-sm">{tickResult}</div> : null}
          {cancelResult ? <div className="text-sm">{cancelResult}</div> : null}
          <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={load}>
            再読み込み
          </button>
        </div>

        {loading ? <div className="text-sm text-zinc-600">読み込み中...</div> : null}
        {error ? <div className="rounded border bg-white p-3 text-sm">{error}</div> : null}

        <div className="rounded-lg border bg-white">
          <div className="grid grid-cols-12 gap-2 border-b p-3 text-xs font-medium text-zinc-600">
            <div className="col-span-4">テーマ</div>
            <div className="col-span-2">投稿先</div>
            <div className="col-span-2">予約日時</div>
            <div className="col-span-2">状態</div>
            <div className="col-span-1">投稿済み</div>
            <div className="col-span-1">操作</div>
          </div>

          {schedules.map((s) => (
            <div key={s.id} className="grid grid-cols-12 gap-2 border-b p-3 text-sm last:border-b-0">
              {(() => {
                const effectiveConfirmed = Boolean(s.isConfirmed || s.draftId);
                const canCancel =
                  s.status === "waiting" &&
                  !s.published &&
                  Boolean(s.postDraftId) &&
                  !Boolean(s.draftId);
                return (
                  <>
              <div className="col-span-4 break-words">
                {s.draft?.theme
                  ? s.draft.theme
                  : s.postDraft?.body
                    ? s.postDraft.body.slice(0, 60)
                    : "（内容なし）"}
              </div>
              <div className="col-span-2">{s.platform}</div>
              <div className="col-span-2 text-xs">{new Date(s.scheduledAt).toLocaleString()}</div>
              <div className="col-span-2">
                {s.status}
                {!effectiveConfirmed ? <div className="mt-1 text-xs text-zinc-600">（未確定）</div> : null}
              </div>
              <div className="col-span-1 text-xs">
                {s.published ? new Date(s.published.postedAt).toLocaleString() : "-"}
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
                <div className="col-span-12 mt-2 rounded border bg-white p-2 text-xs text-red-700">
                  {s.errorText}
                </div>
              ) : null}
                  </>
                );
              })()}
            </div>
          ))}

          {schedules.length === 0 ? (
            <div className="p-6 text-sm text-zinc-600">予約はまだありません。下書き詳細から予約を作成できます。</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
