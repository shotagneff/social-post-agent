"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Platform = "X" | "THREADS";

type Draft = {
  id: string;
  workspaceId: string;
  theme: string;
  status: string;
  variants: any;
  formatted: any;
  approvals?: Array<{
    id: string;
    approvedBy: string;
    note: string | null;
    createdAt: string;
  }>;
  schedules?: Array<{
    id: string;
    platform: Platform;
    scheduledAt: string;
    status: string;
    errorText: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function draftStatusLabel(status: string) {
  switch (status) {
    case "COLLECTED":
      return "収集中";
    case "ANALYZED":
      return "分析中";
    case "DRAFTED":
      return "下書き作成済み";
    case "EDITING":
      return "編集中";
    case "READY_TO_APPROVE":
      return "承認待ち";
    case "APPROVED":
      return "承認済み";
    case "SCHEDULED":
      return "予約済み";
    case "POSTING":
      return "投稿処理中";
    case "POSTED":
      return "投稿済み";
    case "FAILED":
      return "失敗";
    default:
      return status;
  }
}

type DraftStep = "edit" | "confirm" | "approve" | "schedule" | "execute";

function stepTitle(step: DraftStep) {
  switch (step) {
    case "edit":
      return "1. 文章を整える";
    case "confirm":
      return "2. 内容確認（確定）";
    case "approve":
      return "3. 承認する";
    case "schedule":
      return "4. 予約する";
    case "execute":
      return "5. 予約を処理する";
    default:
      return "";
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

export default function DraftDetailPage() {
  const params = useParams<{ id: string }>();
  const draftId = params?.id;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [platform, setPlatform] = useState<Platform>("X");
  const [variantKey, setVariantKey] = useState<"A" | "B" | "C">("A");
  const [text, setText] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string>("");

  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string>("");

  const [approvedBy, setApprovedBy] = useState<string>("");
  const [approveNote, setApproveNote] = useState<string>("");
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<string>("");

  const [schedulePlatform, setSchedulePlatform] = useState<Platform>("X");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string>("");

  const [showEdit, setShowEdit] = useState(true);

  useEffect(() => {
    (async () => {
      if (!draftId) return;
      setLoading(true);
      setError("");
      setSaveResult("");
      setConfirmResult("");
      setApproveResult("");
      setScheduleResult("");

      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setError(String(json?.error ?? "読み込みに失敗しました"));
        setLoading(false);
        return;
      }

      const nextDraft = json.draft as Draft;
      setDraft(nextDraft);
      setLoading(false);
    })();
  }, [draftId]);

  const currentText = useMemo(() => {
    if (!draft) return "";
    const formatted = draft.formatted ?? {};
    const v = formatted?.[platform]?.[variantKey];
    return safeText(v);
  }, [draft, platform, variantKey]);

  useEffect(() => {
    setText(currentText);
  }, [currentText]);

  const variantBody = useMemo(() => {
    if (!draft) return "";
    const variants = draft.variants ?? {};
    return safeText(variants?.[variantKey]?.body);
  }, [draft, variantKey]);

  const step = useMemo<DraftStep>(() => {
    if (!draft) return "edit";
    const approvalsCount = (draft.approvals ?? []).length;
    const schedulesCount = (draft.schedules ?? []).length;

    const formatted = (draft.formatted ?? {}) as any;
    const hasAnyFormatted =
      typeof formatted === "object" && formatted !== null && Object.keys(formatted).length > 0;

    if (!hasAnyFormatted) return "edit";
    if (approvalsCount === 0 && draft.status !== "READY_TO_APPROVE") return "confirm";
    if (approvalsCount === 0) return "approve";
    if (schedulesCount === 0) return "schedule";
    return "execute";
  }, [draft]);

  const stepOrder: DraftStep[] = ["edit", "confirm", "approve", "schedule", "execute"];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  const stepLabels = ["文章を整える", "内容確認", "承認", "予約", "予約を処理"];

  useEffect(() => {
    setShowEdit(step === "edit");
  }, [step]);

  async function confirmReady() {
    if (!draftId) return;

    setConfirming(true);
    setConfirmResult("");

    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/ready`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setConfirmResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setDraft(json.draft as Draft);
      setConfirmResult("確定しました。次は承認です。");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setConfirmResult(`エラー: ${msg}`);
    } finally {
      setConfirming(false);
    }
  }

  async function save() {
    if (!draftId) return;

    setSaving(true);
    setSaveResult("");

    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, variantKey, text }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setSaveResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setDraft(json.draft as Draft);
      setSaveResult("保存しました");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setSaveResult(`エラー: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function schedule() {
    if (!draftId) return;

    setScheduling(true);
    setScheduleResult("");

    try {
      const scheduledAtIso = scheduledAt ? new Date(scheduledAt).toISOString() : "";
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: schedulePlatform, scheduledAt: scheduledAtIso }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setScheduleResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setDraft(json.draft as Draft);
      setScheduleResult("予約を作成しました");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setScheduleResult(`エラー: ${msg}`);
    } finally {
      setScheduling(false);
    }
  }

  async function approve() {
    if (!draftId) return;

    setApproving(true);
    setApproveResult("");

    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy, note: approveNote }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setApproveResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }

      setDraft(json.draft as Draft);
      setApproveResult("承認しました");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setApproveResult(`エラー: ${msg}`);
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">下書き詳細</h1>
          <div className="flex gap-3 text-sm">
            <Link className="underline" href="/drafts">
              下書き一覧
            </Link>
            <Link className="underline" href="/drafts/new">
              新規作成
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm text-zinc-700">
          ここで文章を整え、必要なら承認→予約まで進めます。予約を「過去の日時」にすると、予約一覧からすぐに処理（ダミー投稿）できます。
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="font-medium">いまのステップ: {stepTitle(step)}</div>
          <div className="mt-1 text-xs text-zinc-600">
            まずは文章を整えて保存し、その後に内容確認（確定）→承認へ進みます。
          </div>
        </div>

        <Stepper steps={stepLabels} currentIndex={currentIndex} />

        {loading ? <div className="text-sm text-zinc-600">読み込み中...</div> : null}
        {error ? <div className="rounded border bg-white p-3 text-sm">{error}</div> : null}

        {draft ? (
          <>
            <div className="rounded-lg border bg-white p-4 space-y-2">
              <div className="text-sm text-zinc-600">テーマ</div>
              <div className="text-lg font-medium">{draft.theme}</div>
              <div className="text-xs text-zinc-600">ID: {draft.id}</div>
              <div className="text-xs text-zinc-600">状態: {draftStatusLabel(draft.status)}</div>
            </div>

            {step !== "edit" ? (
              <div className="rounded-lg border bg-white p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">文章を修正したい場合</div>
                    <div className="mt-1 text-xs text-zinc-600">
                      予約前の下書きは、いつでも編集して保存できます。
                    </div>
                  </div>
                  <button
                    className="rounded border px-3 py-2 text-sm"
                    onClick={() => setShowEdit((v) => !v)}
                  >
                    {showEdit ? "編集を閉じる" : "編集を開く"}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "edit" || showEdit ? (
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <div>
                  <div className="text-sm font-medium">文章を整える</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    このステップの完了条件は「保存」です。保存すると次の「内容確認（確定）」に進みます。
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <div className="text-sm font-medium">投稿先</div>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value as Platform)}
                    >
                      <option value="X">X</option>
                      <option value="THREADS">Threads</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <div className="text-sm font-medium">案</div>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={variantKey}
                      onChange={(e) => setVariantKey(e.target.value as "A" | "B" | "C")}
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </label>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">保存</div>
                    <button
                      className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                      disabled={saving}
                      onClick={save}
                    >
                      {saving ? "保存中..." : "保存して次へ（内容確認）"}
                    </button>
                    <div className="mt-1 text-xs text-zinc-600">
                      押すと編集内容が保存され、次のステップが「内容確認（確定）」になります。
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">元の案（生成結果）</div>
                    <textarea
                      className="w-full rounded border p-3 font-mono text-xs"
                      rows={12}
                      value={variantBody}
                      readOnly
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">編集用（保存されます）</div>
                    <textarea
                      className="w-full rounded border p-3 font-mono text-xs"
                      rows={12}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>
                </div>

                {saveResult ? <div className="text-sm">{saveResult}</div> : null}

                <div className="rounded border bg-white p-3 text-xs text-zinc-600">
                  次のステップ: 保存後に「内容確認（確定）」で、この内容で進めるかを確認します。
                </div>
              </div>
            ) : null}

            {step === "confirm" ? (
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <div>
                  <div className="text-sm font-medium">内容確認（確定）</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    ここで「この内容で進める」ことを確定します。確定後に「承認」に進みます。
                  </div>
                </div>

                <div className="rounded border bg-white p-3">
                  <div className="text-xs text-zinc-600">確認対象</div>
                  <div className="mt-1 text-sm">投稿先: {platform} / 案: {variantKey}</div>
                  <div className="mt-2 text-xs text-zinc-600">内容（保存済み）</div>
                  <pre className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{currentText}</pre>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                    disabled={confirming}
                    onClick={confirmReady}
                  >
                    {confirming ? "確定中..." : "この内容で確定して次へ（承認）"}
                  </button>
                  {confirmResult ? <div className="text-sm">{confirmResult}</div> : null}
                </div>

                <div className="rounded border bg-white p-3 text-xs text-zinc-600">
                  まだ直したい場合は「編集を開く」から編集して保存し直してください。
                </div>
              </div>
            ) : null}

            {step === "approve" ? (
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <div className="text-sm font-medium">承認</div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <div className="text-sm font-medium">承認者</div>
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={approvedBy}
                      onChange={(e) => setApprovedBy(e.target.value)}
                      placeholder="例: shotagneff"
                    />
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <div className="text-sm font-medium">メモ</div>
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={approveNote}
                      onChange={(e) => setApproveNote(e.target.value)}
                      placeholder="任意"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                    disabled={approving}
                    onClick={approve}
                  >
                    {approving ? "承認中..." : "承認する"}
                  </button>
                  {approveResult ? <div className="text-sm">{approveResult}</div> : null}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">承認履歴</div>
                  <div className="rounded border bg-white">
                    {(draft.approvals ?? []).length === 0 ? (
                      <div className="p-3 text-sm text-zinc-600">まだ承認履歴はありません。</div>
                    ) : (
                      (draft.approvals ?? []).map((a) => (
                        <div key={a.id} className="border-b p-3 text-sm last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="font-medium">{a.approvedBy}</div>
                            <div className="text-xs text-zinc-600">
                              {new Date(a.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {a.note ? <div className="mt-1 text-zinc-700">{a.note}</div> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded border bg-white p-3 text-xs text-zinc-600">
                  次のステップ: 承認が完了すると「予約」ができるようになります。
                </div>
              </div>
            ) : null}

            {step === "schedule" ? (
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">予約</div>
                  <Link className="text-sm underline" href="/schedules">
                    予約一覧
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <div className="text-sm font-medium">投稿先</div>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={schedulePlatform}
                      onChange={(e) => setSchedulePlatform(e.target.value as Platform)}
                    >
                      <option value="X">X</option>
                      <option value="THREADS">Threads</option>
                    </select>
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <div className="text-sm font-medium">予約日時</div>
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                    disabled={scheduling}
                    onClick={schedule}
                  >
                    {scheduling ? "予約中..." : "予約する"}
                  </button>
                  {scheduleResult ? <div className="text-sm">{scheduleResult}</div> : null}
                </div>

                <div className="rounded border bg-white p-3 text-xs text-zinc-600">
                  次のステップ: 予約を作成したら「予約一覧」で「予約を処理」を押して投稿済みに進めます（いまはダミー投稿）。
                </div>
              </div>
            ) : null}

            {step === "execute" ? (
              <div className="rounded-lg border bg-white p-4 text-sm">
                <div className="font-medium">予約の作成まで完了しています</div>
                <div className="mt-1 text-xs text-zinc-600">
                  次は「予約一覧」へ移動して「予約を処理」を押してください。予約日時が過去のものが対象になります。
                </div>
                <div className="mt-3">
                  <Link className="underline" href="/schedules">
                    予約一覧を開く
                  </Link>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
