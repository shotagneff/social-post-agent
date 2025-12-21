import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <main className="mx-auto max-w-3xl space-y-6 rounded-lg border bg-white p-6">
        <div className="flex items-center gap-3">
          <Image src="/next.svg" alt="Logo" width={90} height={18} priority />
          <h1 className="text-xl font-semibold">ソーシャル投稿エージェント（MVP）</h1>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-zinc-600">最初にセットアップを行い、テーマ入力→投稿案生成（モック）まで動かします。</div>
          <div className="flex flex-wrap gap-3">
            <Link className="rounded bg-black px-4 py-2 text-white" href="/setup">
              セットアップ
            </Link>
            <Link className="rounded border px-4 py-2" href="/drafts">
              下書き
            </Link>
            <Link className="rounded border px-4 py-2" href="/schedules">
              予約
            </Link>
            <a className="rounded border px-4 py-2" href="/api/health" target="_blank" rel="noreferrer">
              ヘルスチェック
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
