"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type WorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  settings?: {
    timezone: string;
  } | null;
};

type ThreadsStatus = {
  connected: boolean;
  threads: {
    userId: string | null;
    tokenExpiresAt: string | null;
    updatedAt: string;
  };
};

function fmt(dt: string | null) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString();
}

export default function ThreadsConnectPage() {
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string>("");
  const [status, setStatus] = useState<ThreadsStatus | null>(null);

  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<string>("");

  const [workspaceIdFromQuery, setWorkspaceIdFromQuery] = useState<string>("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromQuery = String(q.get("workspaceId") ?? "").trim();
    if (fromQuery) setWorkspaceIdFromQuery(fromQuery);

    const resultParam = String(q.get("result") ?? "").trim();
    const messageParam = String(q.get("message") ?? "").trim();
    if (resultParam || messageParam) {
      setResult(messageParam || (resultParam === "ok" ? "完了しました。" : "失敗しました。"));
    }
  }, []);

  useEffect(() => {
    if (workspaceId.trim()) {
      window.localStorage.setItem("lastWorkspaceId", workspaceId.trim());
    }
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

  useEffect(() => {
    if (!workspaceId.trim()) {
      setStatus(null);
      return;
    }

    let canceled = false;
    setStatusLoading(true);
    setStatusError("");
    setStatus(null);

    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/threads`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (canceled) return;
        if (!json?.ok) {
          setStatusError(`エラー: ${json?.error ?? "不明なエラー"}`);
          setStatus(null);
          return;
        }
        setStatus(json as ThreadsStatus);
      })
      .catch((e) => {
        if (canceled) return;
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setStatusError(`エラー: ${msg}`);
      })
      .finally(() => {
        if (canceled) return;
        setStatusLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [workspaceId]);

  const selectedWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === workspaceId) ?? null;
  }, [workspaces, workspaceId]);

  const connectUrl = useMemo(() => {
    if (!workspaceId.trim()) return "";
    return `/api/threads/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}`;
  }, [workspaceId]);

  const nextLinks = useMemo(() => {
    const id = String(workspaceId ?? "").trim();
    const q = id ? `?workspaceId=${encodeURIComponent(id)}` : "";
    return {
      draftsNew: `/drafts/new${q}`,
      postDrafts: `/postdrafts${q}`,
      schedules: `/schedules${q}`,
    };
  }, [workspaceId]);

  const showNextSteps = useMemo(() => {
    if (!workspaceId.trim()) return false;
    if (status?.connected) return true;
    const msg = String(result ?? "").trim();
    if (!msg) return false;
    return msg.includes("完了") || msg.includes("成功") || msg.includes("連携");
  }, [result, status?.connected, workspaceId]);

  async function disconnect() {
    if (!workspaceId.trim()) return;
    if (!confirm("Threads連携を解除します。よろしいですか？")) return;

    setDisconnecting(true);
    setResult("");
    setStatusError("");

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/threads`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setResult("解除しました。");

      const res2 = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/threads`, { cache: "no-store" });
      const json2 = (await res2.json().catch(() => null)) as any;
      if (json2?.ok) setStatus(json2 as ThreadsStatus);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Threads 連携</h1>
        <div className="mt-1 text-sm text-zinc-600">
          投稿先（workspace）ごとにThreadsアカウントを連携します。連携すると、Threadsへの投稿を実行できます。
        </div>
      </div>

      <div className="spa-card p-6">
        <div className="text-sm font-semibold">1. 投稿先を選択</div>
        <div className="mt-2 text-sm text-zinc-600">
          連携したい投稿先を選んでください。投稿先は /setup で作成できます。
        </div>

        <div className="mt-3">
          <select
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={workspacesLoading}
          >
            <option value="">選択してください</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.id.slice(0, 8)}...)
              </option>
            ))}
          </select>
        </div>

        {workspacesLoading ? <div className="mt-2 text-sm text-zinc-600">読み込み中…</div> : null}
        {workspacesError ? <div className="mt-2 text-sm text-red-700">{workspacesError}</div> : null}
      </div>

      <div className="spa-card p-6">
        <div className="text-sm font-semibold">2. 連携状態</div>

        {!workspaceId.trim() ? (
          <div className="mt-2 text-sm text-zinc-600">先に投稿先を選択してください。</div>
        ) : statusLoading ? (
          <div className="mt-2 text-sm text-zinc-600">確認中…</div>
        ) : statusError ? (
          <div className="mt-2 text-sm text-red-600">{statusError}</div>
        ) : status ? (
          <div className="mt-3 space-y-2 text-sm">
            <div>
              <span className="font-semibold">投稿先:</span> {selectedWorkspace?.name ?? "-"}
            </div>
            <div>
              <span className="font-semibold">状態:</span>{" "}
              {status.connected ? (
                <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">連携済み</span>
              ) : (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                  未連携
                </span>
              )}
            </div>
            <div>
              <span className="font-semibold">Threads user_id:</span> {status.threads.userId ?? "-"}
            </div>
            <div>
              <span className="font-semibold">有効期限:</span> {fmt(status.threads.tokenExpiresAt)}
            </div>
            <div>
              <span className="font-semibold">更新:</span> {fmt(status.threads.updatedAt)}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-zinc-600">-</div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className={`spa-button-primary ${workspaceId.trim() ? "" : "opacity-40 pointer-events-none"}`}
            href={connectUrl}
            onClick={(e) => {
              if (!workspaceId.trim()) e.preventDefault();
            }}
          >
            接続する
          </a>

          <button
            className="spa-button-secondary disabled:opacity-50"
            onClick={disconnect}
            disabled={!workspaceId.trim() || disconnecting}
          >
            {disconnecting ? "解除中…" : "解除"}
          </button>
        </div>

        <div className="mt-3 text-sm text-zinc-600">
          接続ボタンを押すとMetaの認可画面に移動します。認可後にこの画面へ戻り、連携状態が「連携済み」になります。
        </div>

        {result ? <div className="mt-3 text-sm">{result}</div> : null}
      </div>

      {showNextSteps ? (
        <div className="spa-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">次にやること</div>
            {status?.connected ? (
              <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                連携済み
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm text-zinc-600">
            連携ができたら、まずは投稿案を作って仮予約→確定へ進むのがおすすめです。
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="spa-button-primary" href={nextLinks.postDrafts}>
              投稿案を作る（大量生成）
            </Link>
            <Link className="spa-button-secondary" href={nextLinks.draftsNew}>
              下書きを作る（1件）
            </Link>
            <Link className="spa-button-secondary" href={nextLinks.schedules}>
              予約を確認
            </Link>
          </div>
          <div className="mt-2 text-xs text-zinc-600">※どの画面も同じ投稿先（workspaceId）で開きます。</div>
        </div>
      ) : null}

      <div className="spa-card p-6">
        <div className="text-sm font-semibold">補足</div>
        <div className="mt-2 text-sm text-zinc-600">
          投稿実行（cron）は「確定済み」の投稿のみを対象にします。投稿案の確定は /postdrafts から行ってください。
        </div>
      </div>
    </div>
  );
}
