"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Platform = "X" | "THREADS";

type WorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  timezone: string;
  postingTargets?: Platform[];
};

type ThemeItem = {
  id?: string;
  title: string;
  enabled?: boolean;
};

type SuggestedTheme = {
  id: string;
  title: string;
};

function isPlatform(x: unknown): x is Platform {
  return x === "X" || x === "THREADS";
}

function uuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900"
      aria-label="loading"
    />
  );
}

export default function ThemesPage() {
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string>("");

  const [platform, setPlatform] = useState<Platform>("X");

  const [suggested, setSuggested] = useState<SuggestedTheme[]>([]);
  const [approved, setApproved] = useState<ThemeItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [result, setResult] = useState<string>("");

  const [workspaceIdFromQuery, setWorkspaceIdFromQuery] = useState<string>("");
  const [platformFromQuery, setPlatformFromQuery] = useState<Platform | "">("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromQuery = String(q.get("workspaceId") ?? "").trim();
    if (fromQuery) setWorkspaceIdFromQuery(fromQuery);

    const platformQuery = String(q.get("platform") ?? "").trim();
    if (isPlatform(platformQuery)) setPlatformFromQuery(platformQuery);
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

        const nextId = String(workspaceIdFromQuery || list[0]?.id || "").trim();
        if (nextId) setWorkspaceId(nextId);

        const desiredPlatform = platformFromQuery || "";
        if (desiredPlatform) {
          setPlatform(desiredPlatform as Platform);
        } else {
          const w = list.find((x) => x.id === nextId) ?? null;
          const allowed = Array.isArray(w?.postingTargets) ? w!.postingTargets!.filter((p) => p === "X" || p === "THREADS") : [];
          if (allowed.length > 0) setPlatform(allowed[0]);
        }
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

  const selectedWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === workspaceId) ?? null;
  }, [workspaces, workspaceId]);

  const allowedPlatforms = useMemo<Platform[]>(() => {
    const raw = selectedWorkspace?.postingTargets;
    const list = Array.isArray(raw) ? raw.filter((p): p is Platform => p === "X" || p === "THREADS") : [];
    return list.length > 0 ? list : ["X", "THREADS"];
  }, [selectedWorkspace]);

  useEffect(() => {
    if (!allowedPlatforms.includes(platform)) {
      setPlatform(allowedPlatforms[0] ?? "X");
    }
  }, [allowedPlatforms, platform]);

  useEffect(() => {
    if (!workspaceId.trim()) return;

    let canceled = false;
    setLoading(true);
    setResult("");

    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/themes?platform=${encodeURIComponent(platform)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (canceled) return;
        if (!json?.ok) {
          setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
          return;
        }
        const list = Array.isArray(json.items) ? (json.items as any[]) : [];
        const normalized = list
          .map((x) => ({
            id: String(x?.id ?? "").trim() || uuid(),
            title: String(x?.title ?? "").trim(),
            enabled: x?.enabled === undefined ? true : Boolean(x.enabled),
          }))
          .filter((x) => Boolean(x.title))
          .slice(0, 50);

        setApproved(normalized);
        setSuggested([]);
      })
      .catch((e) => {
        if (canceled) return;
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setResult(`エラー: ${msg}`);
      })
      .finally(() => {
        if (canceled) return;
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [platform, workspaceId]);

  const nextLinks = useMemo(() => {
    const id = String(workspaceId ?? "").trim();
    const q = id
      ? `?workspaceId=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`
      : `?platform=${encodeURIComponent(platform)}`;
    return {
      postDrafts: `/postdrafts${q}`,
      setup: `/setup${q}`,
    };
  }, [platform, workspaceId]);

  function setTitleAt(i: number, title: string) {
    setApproved((prev) => {
      const next = prev.slice();
      const cur = next[i] ?? { title: "" };
      next[i] = { ...cur, title };
      return next;
    });
  }

  function toggleEnabledAt(i: number) {
    setApproved((prev) => {
      const next = prev.slice();
      const cur = next[i] ?? { title: "" };
      next[i] = { ...cur, enabled: !(cur.enabled === undefined ? true : Boolean(cur.enabled)) };
      return next;
    });
  }

  function setSuggestedTitleAt(i: number, title: string) {
    setSuggested((prev) => {
      const next = prev.slice();
      const cur = next[i];
      if (!cur) return prev;
      next[i] = { ...cur, title };
      return next;
    });
  }

  function approveSuggested(i: number) {
    setSuggested((prev) => {
      const picked = prev[i];
      if (!picked) return prev;
      const rest = prev.filter((_, idx) => idx !== i);
      const title = String(picked.title ?? "").trim();
      if (!title) return rest;
      setApproved((cur) => {
        const exists = cur.some((x) => String(x.title ?? "").trim() === title);
        if (exists) return cur;
        return [{ id: uuid(), title, enabled: true }, ...cur].slice(0, 50);
      });
      return rest;
    });
  }

  function moveBackToSuggested(i: number) {
    setApproved((prev) => {
      const picked = prev[i];
      if (!picked) return prev;
      const rest = prev.filter((_, idx) => idx !== i);
      const title = String(picked.title ?? "").trim();
      if (title) {
        setSuggested((cur) => [{ id: uuid(), title }, ...cur].slice(0, 20));
      }
      return rest;
    });
  }

  function removeApproved(i: number) {
    setApproved((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function suggest() {
    if (!workspaceId.trim()) return;
    setSuggesting(true);
    setResult("");

    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/themes/suggest?platform=${encodeURIComponent(platform)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ count: 5 }),
        },
      );
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      const themes = Array.isArray(json.themes) ? (json.themes as any[]) : [];
      const titles = themes.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 5);
      setSuggested(titles.map((t) => ({ id: uuid(), title: t })));
      setResult("提案を作成しました。採用して確定に入れてください。");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (!workspaceId.trim()) return;
    setSaving(true);
    setResult("");

    try {
      const payload = approved
        .map((x): Required<ThemeItem> => ({
          id: String(x.id ?? "").trim() || uuid(),
          title: String(x.title ?? "").trim(),
          enabled: x.enabled === undefined ? true : Boolean(x.enabled),
        }))
        .filter((x) => Boolean(String(x.title ?? "").trim()))
        .slice(0, 50);

      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/themes?platform=${encodeURIComponent(platform)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: payload }),
        },
      );
      const json = (await res.json().catch(() => null)) as any;
      if (!json?.ok) {
        setResult(`エラー: ${json?.error ?? "不明なエラー"}`);
        return;
      }
      setResult("保存しました。");

      const list = Array.isArray(json.items) ? (json.items as any[]) : [];
      const normalized = list
        .map((x) => ({
          id: String(x?.id ?? "").trim() || uuid(),
          title: String(x?.title ?? "").trim(),
          enabled: x?.enabled === undefined ? true : Boolean(x.enabled),
        }))
        .filter((x) => Boolean(x.title))
        .slice(0, 50);
      setApproved(normalized);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setResult(`エラー: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">テーマ設計</h1>
        <div className="mt-1 text-sm text-zinc-600">AIの提案から選んで、確定テーマを保存します。</div>
      </div>

      <div className="spa-card p-6">
        <div className="text-sm font-semibold">1. 投稿設計を選択</div>
        <div className="mt-2 text-sm text-zinc-600">テーマを作りたい投稿設計を選んでください。</div>

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

        {workspacesError ? <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm">{workspacesError}</div> : null}
      </div>

      <div className="spa-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold">2. プラットフォーム別テーマ</div>
            <div className="mt-1 text-sm text-zinc-600">X用 / Threads用で別管理できます。</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`rounded-xl border px-3 py-2 text-sm ${platform === "X" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"}`}
              disabled={!allowedPlatforms.includes("X")}
              onClick={() => setPlatform("X")}
              type="button"
            >
              X
            </button>
            <button
              className={`rounded-xl border px-3 py-2 text-sm ${platform === "THREADS" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"}`}
              disabled={!allowedPlatforms.includes("THREADS")}
              onClick={() => setPlatform("THREADS")}
              type="button"
            >
              Threads
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-zinc-600">提案から選んで確定へ。確定は保存されます。</div>
            <div className="flex items-center gap-2">
              <button className="spa-button-secondary disabled:opacity-50" disabled={!workspaceId.trim() || suggesting || loading} onClick={suggest}>
                <span className="inline-flex items-center gap-2">
                  {suggesting ? <Spinner /> : null}
                  <span>{suggesting ? "作成中..." : "AIで提案"}</span>
                </span>
              </button>
              <button className="spa-button-primary disabled:opacity-50" disabled={!workspaceId.trim() || saving || loading} onClick={save}>
                <span className="inline-flex items-center gap-2">
                  {saving ? <Spinner /> : null}
                  <span>{saving ? "保存中..." : "確定を保存"}</span>
                </span>
              </button>
            </div>
          </div>

          {loading ? <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm">読み込み中...</div> : null}

          {!loading ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">提案</div>
                  <div className="text-xs text-zinc-600">{suggested.length}件</div>
                </div>
                <div className="mt-3 space-y-2">
                  {suggested.length === 0 ? (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                      「AIで提案」で候補を作ります。
                    </div>
                  ) : null}
                  {suggested.map((s, idx) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
                      <button
                        className="h-9 w-16 rounded-xl border border-zinc-900 bg-zinc-900 text-sm text-white"
                        type="button"
                        onClick={() => approveSuggested(idx)}
                      >
                        承認
                      </button>
                      <input
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                        value={s.title}
                        onChange={(e) => setSuggestedTitleAt(idx, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">確定</div>
                  <div className="text-xs text-zinc-600">{approved.length}件</div>
                </div>
                <div className="mt-3 space-y-2">
                  {approved.length === 0 ? (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                      提案から「承認」するとここに入ります。
                    </div>
                  ) : null}
                  {approved.map((it, idx) => (
                    <div key={it.id ?? idx} className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <button
                          className={`h-9 w-16 rounded-xl border text-sm ${it.enabled === false ? "border-zinc-200 bg-white text-zinc-400" : "border-zinc-900 bg-zinc-900 text-white"}`}
                          type="button"
                          onClick={() => toggleEnabledAt(idx)}
                          title={it.enabled === false ? "無効（クリックで有効）" : "有効（クリックで無効）"}
                        >
                          {it.enabled === false ? "無効" : "有効"}
                        </button>
                        <input
                          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                          value={it.title}
                          onChange={(e) => setTitleAt(idx, e.target.value)}
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button className="spa-button-secondary" type="button" onClick={() => moveBackToSuggested(idx)}>
                          戻す
                        </button>
                        <button className="spa-button-secondary" type="button" onClick={() => removeApproved(idx)}>
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {result ? <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm">{result}</div> : null}
        </div>
      </div>

      <div className="spa-card p-6">
        <div className="text-sm font-semibold">次の操作</div>
        <div className="mt-2 text-sm text-zinc-600">テーマを保存したら、投稿案の作成に進みます。</div>
        <div className="mt-4 flex flex-col gap-2 md:flex-row">
          <Link className="spa-button-primary text-center" href={nextLinks.postDrafts}>
            投稿案の作成へ
          </Link>
          <Link className="spa-button-secondary text-center" href={nextLinks.setup}>
            セットアップへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
