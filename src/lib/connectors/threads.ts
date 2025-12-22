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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { res, text, json };
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
}): Promise<ThreadsPublishResult> {
  try {
    const accessToken = String(args.accessToken ?? "").trim();
    const userId = String(args.userId ?? "").trim();
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
    });

    if (!created.res.ok) {
      const retryable = created.res.status >= 500;
      const errMsg =
        (created.json?.error?.message as string | undefined) ??
        `${created.res.status} ${created.text || "Threads create failed"}`;
      return { ok: false, error: `Threads create error: ${errMsg}`, retryable, raw: created.json ?? created.text };
    }

    const creationId = String(created.json?.id ?? "").trim();
    if (!creationId) {
      return { ok: false, error: "Threads create returned no id", retryable: false, raw: created.json };
    }

    const publishUrl = withQueryParams(
      withAccessToken(`https://graph.threads.net/${version}/${encodeURIComponent(userId)}/threads_publish`, accessToken),
      { creation_id: creationId }
    );
    const published = await postForm(publishUrl, {});

    if (!published.res.ok) {
      const retryable = published.res.status >= 500;
      const errMsg =
        (published.json?.error?.message as string | undefined) ??
        `${published.res.status} ${published.text || "Threads publish failed"}`;
      return {
        ok: false,
        error: `Threads publish error: ${errMsg}`,
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

    const externalPostId = String(published.json?.id ?? "").trim();
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
