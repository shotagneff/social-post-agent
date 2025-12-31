"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ThemesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/postdrafts");
  }, [router]);

  return <div className="spa-card p-6 text-sm text-zinc-700">投稿下書きへ移動します...</div>;
}
