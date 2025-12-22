"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  settings?: {
    timezone: string;
  } | null;
};

type NewDraftStep = "workspace" | "theme" | "options" | "generate" | "done";

function stepTitle(step: NewDraftStep) {
  switch (step) {
    case "workspace":
      return "1. 投稿先";
    case "theme":
      return "2. テーマ";
    case "options":
      return "3. 生成方法";
    case "generate":
      return "4. 生成";
    case "done":
      return "完了";
  }
}

function Stepper(props: { steps: string[]; currentIndex: number }) {
  const { steps, currentIndex } = props;
  return (
    <div className="rounded-lg border bg-white p-4">
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
            <div key={`${idx}-${label}`} className={`flex items-center gap-2 ${textClass}`}
            >
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${circleClass}`}
              >
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

export default function NewDraftClient() {
  const search = useSearchParams();
  const [workspaceId, setWorkspaceId] = useState(search.get("workspaceId") ?? "");
  const [theme, setTheme] = useState("");
  const [useOpenAI, setUseOpenAI] = useState(false);
  const [result, setResult] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const [step, setStep] = useState<NewDraftStep>(workspaceId ? "theme" : "workspace");
  const [createdDraftId, setCreatedDraftId] = useState<string>("");

  const stepOrder: NewDraftStep[] = ["workspace", "theme", "options", "generate", "done"];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  const stepLabels = ["投稿先", "テーマ", "生成方法", "生成", "完了"];

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoadingWorkspaces(true);
      setWorkspacesError("");
      try {
        const res = await fetch("/api/workspaces");
        const json = (await res.json().catch(() => null)) as any;
        if (!json?.ok) {
          setWorkspacesError(String(json?.error ?? "投稿先一覧の読み込みに失敗しました"));
          setWorkspaces([]);
          return;
        }
        const list = (json.workspaces ?? []) as Workspace[];
        setWorkspaces(list);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setWorkspacesError(msg);
        setWorkspaces([]);
      } finally {
        setLoadingWorkspaces(false);
      }
    })();
  }, []);

  const workspaceOptions = useMemo(() => {
    return workspaces.map((w) => ({
      id: w.id,
      label: `${w.name} (${w.id.slice(0, 8)}...)`,
    }));
  }, [workspaces]);

  async function create() {
    setCreating(true);
    setResult("");
    setCreatedDraftId("");

    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, theme, useOpenAI }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      const draftId = String(json.draft?.id ?? "");
      const generator = String(json.meta?.generator ?? "");
      const llmError = json.meta?.llmError ? String(json.meta.llmError) : "";
      setCreatedDraftId(draftId);
      setResult(
        `作成しました: draftId=${draftId}${generator ? `（生成=${generator}）` : ""}${llmError ? `（注意: ${llmError}）` : ""}`,
      );
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">下書きを作る</h1>
          <div className="flex gap-3 text-sm">
            <Link className="underline" href="/drafts">
              下書き一覧
            </Link>
            <Link className="underline" href="/setup">
              セットアップ
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm text-zinc-700">
          投稿先を選び、作りたい投稿のテーマを入力してください。生成後は下書き詳細で文章の調整→承認→予約へ進めます。
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="font-medium">いまのステップ: {stepTitle(step)}</div>
          <div className="mt-1 text-xs text-zinc-600">順番に入力すると、次の項目が表示されます。</div>
        </div>

        <Stepper steps={stepLabels} currentIndex={currentIndex} />

        <div className="rounded-lg border bg-white p-4 space-y-3">
          {step === "workspace" ? (
            <>
              <div className="text-sm font-medium">投稿先</div>
              <div className="space-y-1">
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                >
                  <option value="">選択してください...</option>
                  {workspaceOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {loadingWorkspaces ? (
                  <div className="text-xs text-zinc-600">投稿先一覧を読み込み中...</div>
                ) : null}
                {workspacesError ? <div className="text-xs text-red-700">{workspacesError}</div> : null}
              </div>

              <label className="space-y-1 block">
                <div className="text-sm font-medium">投稿先ID（必要なら手入力）</div>
                <input
                  className="w-full rounded border px-3 py-2 font-mono text-xs"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                />
              </label>

              <div className="flex items-center justify-between gap-2">
                <Link className="text-sm underline" href="/setup">
                  先にセットアップをする
                </Link>
                <button
                  className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={!workspaceId}
                  onClick={() => setStep("theme")}
                >
                  次へ
                </button>
              </div>
            </>
          ) : null}

          {step === "theme" ? (
            <>
              <div className="text-sm font-medium">テーマ</div>
              <label className="space-y-1 block">
                <div className="text-sm font-medium">作りたい投稿のテーマ</div>
                <input
                  className="w-full rounded border px-3 py-2"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="例: 就活の面接で緊張しないコツ"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep("workspace")}
                >
                  戻る
                </button>
                <button
                  className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={!theme.trim()}
                  onClick={() => setStep("options")}
                >
                  次へ
                </button>
              </div>
            </>
          ) : null}

          {step === "options" ? (
            <>
              <div className="text-sm font-medium">生成方法</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useOpenAI}
                  onChange={(e) => setUseOpenAI(e.target.checked)}
                />
                OpenAIで生成する（OPENAI_API_KEYが設定されている場合）
              </label>
              <div className="flex items-center justify-between gap-2">
                <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep("theme")}
                >
                  戻る
                </button>
                <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={() => setStep("generate")}
                >
                  次へ
                </button>
              </div>
            </>
          ) : null}

          {step === "generate" ? (
            <>
              <div className="text-sm font-medium">生成</div>
              <button
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                disabled={creating}
                onClick={create}
              >
                {creating
                  ? "作成中..."
                  : useOpenAI
                    ? "投稿案を3つ生成（OpenAI）"
                    : "投稿案を3つ生成（モック）"}
              </button>
              {result ? <div className="text-sm">{result}</div> : null}
              <div className="flex items-center justify-between gap-2">
                <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep("options")}
                >
                  戻る
                </button>
                <button
                  className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={!createdDraftId}
                  onClick={() => setStep("done")}
                >
                  次へ
                </button>
              </div>
            </>
          ) : null}

          {step === "done" ? (
            <>
              <div className="text-sm font-medium">完了</div>
              <div className="text-sm text-zinc-700">
                生成が完了しました。次は下書き詳細で文章を整えて、承認→予約へ進みます。
              </div>
              {createdDraftId ? (
                <div className="flex flex-wrap gap-3">
                  <Link
                    className="rounded bg-black px-4 py-2 text-sm text-white"
                    href={`/drafts/${encodeURIComponent(createdDraftId)}`}
                  >
                    下書き詳細を開く
                  </Link>
                  <Link className="rounded border px-4 py-2 text-sm" href="/drafts">
                    下書き一覧へ
                  </Link>
                </div>
              ) : (
                <div className="text-sm">{result}</div>
              )}
            </>
          ) : null}
        </div>

        <div className="text-sm text-zinc-600">
          いまはモック生成です。次のステップでPersona/Genreを参照してLLM生成に置き換えます。
        </div>
      </div>
    </div>
  );
}
