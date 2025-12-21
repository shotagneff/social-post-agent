import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const s = pad === 0 ? padded : padded + "=".repeat(4 - pad);
  return Buffer.from(s, "base64").toString("utf8");
}

function parseSignedRequest(signedRequest: string, appSecret: string) {
  const parts = signedRequest.split(".");
  if (parts.length !== 2) throw new Error("signed_request is invalid");
  const [encodedSig, encodedPayload] = parts;

  const sig = Buffer.from(encodedSig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const payloadJson = base64UrlDecode(encodedPayload);
  const payload = JSON.parse(payloadJson) as any;

  const expected = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (expected.length !== sig.length || !crypto.timingSafeEqual(expected, sig)) {
    throw new Error("signed_request signature mismatch");
  }

  return payload;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    let signedRequest = "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as any;
      signedRequest = String(body?.signed_request ?? "").trim();
    } else {
      const form = await req.formData().catch(() => null);
      signedRequest = String(form?.get("signed_request") ?? "").trim();
    }

    if (!signedRequest) {
      return NextResponse.json({ ok: false, error: "signed_request is required" }, { status: 400 });
    }

    const appSecret = mustEnv("THREADS_OAUTH_CLIENT_SECRET");
    parseSignedRequest(signedRequest, appSecret);

    const confirmationCode = crypto.randomBytes(16).toString("hex");

    const url = new URL(req.url);
    const statusUrl = new URL("/api/meta/data-deletion/status", url.origin);
    statusUrl.searchParams.set("code", confirmationCode);

    return NextResponse.json({
      url: statusUrl.toString(),
      confirmation_code: confirmationCode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
