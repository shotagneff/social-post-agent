export const dynamic = "force-dynamic";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4 rounded-lg border bg-white p-6">
        <h1 className="text-2xl font-semibold">プライバシーポリシー</h1>

        <section className="space-y-2 text-sm text-zinc-800">
          <p>
            本アプリ（social-post-agent-eight）は、Threads等への投稿作業を支援するためのツールです。以下は、個人/小規模利用を想定した簡易的なプライバシーポリシーです。
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">取得する情報</h2>
          <p>
            本アプリは、ユーザーが連携を許可した場合に限り、Threads APIのアクセストークンおよび関連する識別子（user_id等）を保存します。
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">利用目的</h2>
          <p>
            取得した情報は、ユーザーが指定した投稿先におけるThreadsへの投稿・投稿管理（予約投稿の実行など）のために利用します。
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">第三者提供</h2>
          <p>法令に基づく場合を除き、取得した情報を第三者へ提供しません。</p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">データ削除</h2>
          <p>
            データ削除の手順は、以下のページをご確認ください。
            <a className="ml-1 underline" href="/data-deletion">
              データ削除手順
            </a>
          </p>
        </section>

        <section className="space-y-2 text-sm text-zinc-800">
          <h2 className="text-base font-medium">お問い合わせ</h2>
          <p>
            本アプリは個人利用を想定しています。お問い合わせ先が必要な場合は、運用者が別途指定した連絡手段をご利用ください。
          </p>
        </section>

        <div className="pt-2 text-xs text-zinc-500">最終更新: 2025-12-21</div>
      </div>
    </main>
  );
}
