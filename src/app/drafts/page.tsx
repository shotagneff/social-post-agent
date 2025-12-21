"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DraftRow = {
  id: string;
  workspaceId: string;
  theme: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      setError("");
      const res = await fetch("/api/drafts");
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setError(String(json?.error ?? "読み込みに失敗しました"));
        return;
      }
      setDrafts((json.drafts ?? []) as DraftRow[]);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">下書き一覧</h1>
          <div className="flex gap-3 text-sm">
            <Link className="underline" href="/setup">
              セットアップ
            </Link>
            <Link className="underline" href="/drafts/new">
              新規作成
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm text-zinc-700">
          ここでは作成した下書きを一覧で確認できます。まだ無い場合は「新規作成」からテーマを入力して投稿案を生成してください。
        </div>

        {error ? <div className="rounded border bg-white p-3 text-sm">{error}</div> : null}

        <div className="rounded-lg border bg-white">
          <div className="grid grid-cols-12 gap-2 border-b p-3 text-xs font-medium text-zinc-600">
            <div className="col-span-4">テーマ</div>
            <div className="col-span-4">ワークスペース</div>
            <div className="col-span-2">状態</div>
            <div className="col-span-2">作成日時</div>
          </div>
          {drafts.map((d) => (
            <div key={d.id} className="grid grid-cols-12 gap-2 p-3 text-sm border-b last:border-b-0">
              <div className="col-span-4 break-words">
                <Link className="underline" href={`/drafts/${encodeURIComponent(d.id)}`}>
                  {d.theme}
                </Link>
              </div>
              <div className="col-span-4 font-mono text-xs break-all">{d.workspaceId}</div>
              <div className="col-span-2">{d.status}</div>
              <div className="col-span-2 text-xs">{new Date(d.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {drafts.length === 0 ? (
            <div className="p-6 text-sm text-zinc-600">下書きはまだありません。まずは「新規作成」から作ってみましょう。</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
