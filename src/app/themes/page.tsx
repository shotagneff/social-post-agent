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

  const [items, setItems] = useState<ThemeItem[]>([
    { title: "" },
    { title: "" },
    { title: "" },
    { title: "" },
    { title: "" },
  ]);

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

        if (normalized.length === 0) {
          setItems([
            { title: "" },
            { title: "" },
            { title: "" },
            { title: "" },
            { title: "" },
          ]);
        } else {
          setItems(normalized);
        }
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
    const q = id ? `?workspaceId=${encodeURIComponent(id)}` : "";
    return {
      postDrafts: `/postdrafts${q}`,
      setup: `/setup${q}`,
    };
  }, [workspaceId]);

  function setTitleAt(i: number, title: string) {
    setItems((prev) => {
      const next = prev.slice();
      const cur = next[i] ?? { title: "" };
      next[i] = { ...cur, title };
      return next;
    });
  }

  function toggleEnabledAt(i: number) {
    setItems((prev) => {
      const next = prev.slice();
      const cur = next[i] ?? { title: "" };
      next[i] = { ...cur, enabled: !(cur.enabled === undefined ? true : Boolean(cur.enabled)) };
      return next;
    });
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
      const nextItems: ThemeItem[] = titles.map((t) => ({ id: uuid(), title: t, enabled: true }));
      while (nextItems.length < 5) nextItems.push({ id: uuid(), title: "", enabled: true });
      setItems(nextItems);
      setResult("テーマ案を作成しました。必要なら編集して保存してください。");
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
      const payload = items
        .map((x) => ({
          id: String(x.id ?? "").trim() || uuid(),
          title: String(x.title ?? "").trim(),
          enabled: x.enabled === undefined ? true : Boolean(x.enabled),
        }))
        .filter((x) => Boolean(x.title))
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
      setItems(normalized.length ? normalized : [{ title: "" }, { title: "" }, { title: "" }, { title: "" }, { title: "" }]);
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
        <div className="mt-1 text-sm text-zinc-600">
          投稿設計（workspace）ごとに、投稿のテーマを保存します。まずはAIで5案を作って、必要なら編集して保存してください。
        </div>
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
            <div className="mt-1 text-sm text-zinc-600">X用 / Threads用で分けて保存できます。</div>
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
            <div className="text-sm text-zinc-600">保存済みテーマを読み込み、編集できます。</div>
            <div className="flex items-center gap-2">
              <button className="spa-button-secondary disabled:opacity-50" disabled={!workspaceId.trim() || suggesting || loading} onClick={suggest}>
                <span className="inline-flex items-center gap-2">
                  {suggesting ? <Spinner /> : null}
                  <span>{suggesting ? "作成中..." : "AIで5案を作る"}</span>
                </span>
              </button>
              <button className="spa-button-primary disabled:opacity-50" disabled={!workspaceId.trim() || saving || loading} onClick={save}>
                <span className="inline-flex items-center gap-2">
                  {saving ? <Spinner /> : null}
                  <span>{saving ? "保存中..." : "保存"}</span>
                </span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm">読み込み中...</div>
          ) : (
            <div className="mt-4 space-y-2">
              {items.map((it, idx) => (
                <div key={it.id ?? idx} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
                  <button
                    className={`h-9 w-9 rounded-xl border text-sm ${it.enabled === false ? "border-zinc-200 bg-white text-zinc-400" : "border-zinc-900 bg-zinc-900 text-white"}`}
                    type="button"
                    onClick={() => toggleEnabledAt(idx)}
                    title={it.enabled === false ? "無効（クリックで有効）" : "有効（クリックで無効）"}
                  >
                    {it.enabled === false ? "-" : "✓"}
                  </button>
                  <input
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    value={it.title}
                    onChange={(e) => setTitleAt(idx, e.target.value)}
                    placeholder={idx < 5 ? `テーマ案${idx + 1}` : "テーマ"}
                  />
                </div>
              ))}
            </div>
          )}

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
