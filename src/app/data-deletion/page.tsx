export const dynamic = "force-dynamic";

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4 rounded-lg border bg-white p-6">
        <h1 className="text-2xl font-semibold">データ削除手順</h1>

        <section className="space-y-2 text-sm text-zinc-800">
          <p>
            本ページは、Meta（Facebook/Threads）経由で本アプリを利用した際のデータ削除手順を説明します。
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">削除されるデータ</h2>
          <p>
            本アプリが保存する、Threads連携に関する情報（アクセストークン、user_id、期限等）が対象です。
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">手順（推奨）</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <a className="underline" href="/threads/connect">
                /threads/connect
              </a>
              を開き、該当ワークスペースを選択します。
            </li>
            <li>「解除する（Disconnect）」を実行します。</li>
            <li>解除後、しばらくしてから再度状態を確認し、連携が解除されていることを確認します。</li>
          </ol>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">Metaからの削除リクエストについて</h2>
          <p>
            Metaのデータ削除フローで送信された削除リクエストは、サーバー側の削除エンドポイントで受け付けます。
          </p>
        </section>

        <div className="pt-2 text-xs text-zinc-500">最終更新: 2025-12-21</div>
      </div>
    </main>
  );
}
