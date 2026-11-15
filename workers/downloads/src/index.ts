type Env = {
  CUEPORT_DOWNLOADS: R2Bucket;
  DOWNLOAD_SECRET: string;
  /** Filename of the current release DMG, e.g. "Cueport_0.3.0_aarch64.dmg". Set via wrangler var. */
  CURRENT_DMG: string;
  /** Optional D1 binding for future Lemon Squeezy entitlements. Not required for public downloads. */
  LICENSE_ENTITLEMENTS?: D1Database;
  /** Lemon Squeezy webhook signing secret. Set only when licensing is enabled. */
  LEMON_SQUEEZY_WEBHOOK_SECRET?: string;
};

const LICENSING_DISABLED = {
  ok: false,
  code: "licensing_not_configured",
  message: "Cueport licensing endpoints are present but not enabled for this deployment.",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/license/") || url.pathname === "/webhooks/lemon-squeezy") {
      return handleLicensingRequest(request, env, url);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const file = url.searchParams.get("file") || env.CURRENT_DMG;
    const expires = url.searchParams.get("expires");
    const signature = url.searchParams.get("signature");

    if (!expires || !signature) {
      return new Response("Missing download token", { status: 403 });
    }

    const expiry = Number(expires);
    if (!Number.isSafeInteger(expiry) || Date.now() > expiry * 1000) {
      return new Response("Download link expired", { status: 403 });
    }

    const valid = await verifySignature(env.DOWNLOAD_SECRET, file, expires, signature);
    if (!valid) {
      return new Response("Invalid download token", { status: 403 });
    }

    const object = await env.CUEPORT_DOWNLOADS.get(file);
    if (!object) {
      return new Response("File not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("content-type", "application/x-apple-diskimage");
    headers.set("content-disposition", `attachment; filename="${file}"`);
    headers.set("cache-control", "private, no-store");

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    return new Response(object.body, { headers });
  }
};

async function handleLicensingRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/webhooks/lemon-squeezy") {
    return handleLemonSqueezyWebhook(request, env);
  }

  if (request.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed" }, 405);
  }

  if (!env.LICENSE_ENTITLEMENTS) {
    return json(LICENSING_DISABLED, 503);
  }

  if (url.pathname === "/license/activate") {
    return json({
      ok: false,
      code: "activation_not_implemented",
      message: "Activation is intentionally disabled until Lemon Squeezy test mode is configured.",
    }, 501);
  }

  if (url.pathname === "/license/validate") {
    return json({
      ok: false,
      code: "validation_not_implemented",
      message: "Validation is intentionally disabled until Lemon Squeezy test mode is configured.",
    }, 501);
  }

  return json({ ok: false, code: "not_found" }, 404);
}

async function handleLemonSqueezyWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed" }, 405);
  }

  if (!env.LICENSE_ENTITLEMENTS || !env.LEMON_SQUEEZY_WEBHOOK_SECRET) {
    return json(LICENSING_DISABLED, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature") || "";
  const valid = await verifyWebhookSignature(env.LEMON_SQUEEZY_WEBHOOK_SECRET, rawBody, signature);
  if (!valid) {
    return json({ ok: false, code: "invalid_signature" }, 401);
  }

  const eventKey = await sha256Hex(rawBody);
  let payload: LemonSqueezyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LemonSqueezyWebhookPayload;
  } catch {
    return json({ ok: false, code: "invalid_json" }, 400);
  }
  const eventName = payload.meta?.event_name || "unknown";

  await env.LICENSE_ENTITLEMENTS
    .prepare(
      `INSERT OR IGNORE INTO lemon_squeezy_webhook_events
        (event_key, event_name, payload_json, received_at)
       VALUES (?1, ?2, ?3, unixepoch())`
    )
    .bind(eventKey, eventName, rawBody)
    .run();

  return json({
    ok: true,
    eventName,
    eventKey,
    mode: "recorded_only",
  });
}

async function verifySignature(
  secret: string,
  file: string,
  expires: string,
  received: string
): Promise<boolean> {
  const expected = await sign(secret, file, expires);
  return timingSafeEqual(expected, received);
}

async function verifyWebhookSignature(secret: string, rawBody: string, received: string): Promise<boolean> {
  if (!received) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return timingSafeEqual(hex(new Uint8Array(signature)), received.toLowerCase());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function sign(secret: string, file: string, expires: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${file}.${expires}`)
  );

  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type LemonSqueezyWebhookPayload = {
  meta?: {
    event_name?: string;
  };
  data?: unknown;
};
