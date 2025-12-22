import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Social Post Agent",
  description: "Draft, schedule, and post to Threads with a lightweight workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen">
          <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-zinc-900" />
                <div>
                  <div className="text-sm font-semibold">Social Post Agent</div>
                  <div className="text-xs text-zinc-600">Threads 投稿ワークフロー</div>
                </div>
              </div>

              <nav className="flex items-center gap-3 text-sm">
                <a className="rounded-lg px-3 py-2 text-zinc-700 hover:bg-zinc-100" href="/setup?step=workspace">
                  セットアップ
                </a>
                <a className="rounded-lg px-3 py-2 text-zinc-700 hover:bg-zinc-100" href="/threads/connect">
                  Threads連携
                </a>
                <a className="rounded-lg px-3 py-2 text-zinc-700 hover:bg-zinc-100" href="/postdrafts">
                  PostDraft
                </a>
                <a className="rounded-lg px-3 py-2 text-zinc-700 hover:bg-zinc-100" href="/schedules">
                  予約
                </a>
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
