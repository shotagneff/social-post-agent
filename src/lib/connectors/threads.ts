export type ThreadsPublishResult =
  | {
      ok: true;
      externalPostId: string;
      raw: unknown;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      raw?: unknown;
    };

async function postForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { res, text, json };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withAccessToken(url: string, accessToken: string) {
  const u = new URL(url);
  u.searchParams.set("access_token", accessToken);
  return u.toString();
}

function withQueryParams(url: string, params: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

export async function publishToThreadsText(args: {
  text: string;
  accessToken: string;
  userId: string;
  replyToId?: string;
}): Promise<ThreadsPublishResult> {
  try {
    const accessToken = String(args.accessToken ?? "").trim();
    const userId = String(args.userId ?? "").trim();
    const replyToId = String(args.replyToId ?? "").trim();
    const rawVersion = String(process.env.THREADS_API_VERSION ?? "v1.0").trim();
    const version = /^v\d+\.\d+$/.test(rawVersion) ? rawVersion : "v1.0";

    if (!accessToken) {
      return { ok: false, error: "Threadsアクセストークンがありません。", retryable: false };
    }

    if (!userId) {
      return { ok: false, error: "Threads user_id がありません。", retryable: false };
    }

    const trimmed = String(args.text ?? "").trim();
    if (!trimmed) {
      return { ok: false, error: "text is empty", retryable: false };
    }

    const createUrl = withAccessToken(
      `https://graph.threads.net/${version}/${encodeURIComponent(userId)}/threads`,
      accessToken
    );
    const created = await postForm(createUrl, {
      media_type: "TEXT",
      text: trimmed,
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      access_token: accessToken,
    });

    const createdJson = created.json as { id?: unknown; error?: { message?: unknown } } | null;
    if (!created.res.ok) {
      const retryable = created.res.status >= 500;
      const errMsg =
        (typeof createdJson?.error?.message === "string" ? createdJson.error.message : undefined) ??
        `${created.res.status} ${created.text || "Threads create failed"}`;
      return {
        ok: false,
        error: `Threads create error: (${created.res.status}) ${errMsg}`,
        retryable,
        raw: created.json ?? created.text,
      };
    }

    const creationId = String(createdJson?.id ?? "").trim();
    if (!creationId) {
      return { ok: false, error: "Threads create returned no id", retryable: false, raw: created.json };
    }

    const publishUrl = withQueryParams(
      withAccessToken(`https://graph.threads.net/${version}/${encodeURIComponent(userId)}/threads_publish`, accessToken),
      { creation_id: creationId }
    );
    let published = await postForm(publishUrl, {
      creation_id: creationId,
      access_token: accessToken,
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (published.res.ok) break;

      const publishedJson = published.json as { id?: unknown; error?: { message?: unknown } } | null;
      const msg = String(
        (typeof publishedJson?.error?.message === "string" ? publishedJson.error.message : undefined) ??
          published.text ??
          ""
      ).toLowerCase();
      const isResourceMissing = msg.includes("requested resource does not exist") || msg.includes("resource does not exist");
      if (!isResourceMissing) break;

      // Sometimes the creation_id is not immediately publishable; retry briefly.
      await sleep(800 * attempt);
      published = await postForm(publishUrl, {
        creation_id: creationId,
        access_token: accessToken,
      });
    }

    if (!published.res.ok) {
      const retryable = published.res.status >= 500;
      const publishedJson = published.json as { id?: unknown; error?: { message?: unknown } } | null;
      const errMsg =
        (typeof publishedJson?.error?.message === "string" ? publishedJson.error.message : undefined) ??
        `${published.res.status} ${published.text || "Threads publish failed"}`;
      return {
        ok: false,
        error: `Threads publish error: (${published.res.status}) ${errMsg}`,
        retryable,
        raw: {
          mode: "threads",
          step: "publish",
          version,
          userId,
          creationId,
          http: { status: published.res.status, ok: published.res.ok },
          publish: published.json ?? published.text,
          note: "access_token is not included in this payload",
        },
      };
    }

    const publishedJson = published.json as { id?: unknown; error?: { message?: unknown } } | null;
    const externalPostId = String(publishedJson?.id ?? "").trim();
    if (!externalPostId) {
      return {
        ok: false,
        error: "Threads publish returned no id",
        retryable: false,
        raw: { creationId, publish: published.json },
      };
    }

    return {
      ok: true,
      externalPostId,
      raw: {
        mode: "threads",
        version,
        userId,
        creationId,
        publish: published.json,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const retryable = msg.includes("fetch") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET");
    return { ok: false, error: msg, retryable };
  }
}

export async function publishToThreadsThread(args: {
  text: string;
  replies: string[];
  accessToken: string;
  userId: string;
}): Promise<ThreadsPublishResult> {
  const main = await publishToThreadsText({
    text: args.text,
    accessToken: args.accessToken,
    userId: args.userId,
  });
  if (!main.ok) return main;

  let parentId = main.externalPostId;
  const postedReplyIds: string[] = [];
  const replies = (Array.isArray(args.replies) ? args.replies : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);

  for (let i = 0; i < replies.length; i++) {
    const r = replies[i];
    const res = await publishToThreadsText({
      text: r,
      replyToId: parentId,
      accessToken: args.accessToken,
      userId: args.userId,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Threads reply error (index=${i + 1}): ${res.error}`,
        retryable: false,
        raw: {
          mode: "threads",
          step: "reply",
          mainExternalPostId: main.externalPostId,
          postedReplyIds,
          failedAtIndex: i,
          failedTextLen: String(r ?? "").length,
          cause: res.raw ?? res.error,
        },
      };
    }
    parentId = res.externalPostId;
    postedReplyIds.push(res.externalPostId);
    await sleep(250);
  }

  return {
    ok: true,
    externalPostId: main.externalPostId,
    raw: {
      ...((typeof main.raw === "object" && main.raw !== null
        ? (main.raw as Record<string, unknown>)
        : { mainRaw: main.raw }) as Record<string, unknown>),
      thread: {
        mainExternalPostId: main.externalPostId,
        replyExternalPostIds: postedReplyIds,
      },
    },
  };
}
