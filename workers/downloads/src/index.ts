type Env = {
  CUEPORT_DOWNLOADS: R2Bucket;
  DOWNLOAD_SECRET: string;
  /** Filename of the current release DMG, e.g. "Cueport_0.3.0_aarch64.dmg". Set via wrangler var. */
  CURRENT_DMG: string;
  /** D1 binding for Paddle commerce events and Cueport license entitlements. */
  LICENSE_ENTITLEMENTS?: D1Database;
  /** Paddle notification destination secret. Set as a Cloudflare secret. */
  PADDLE_WEBHOOK_SECRET?: string;
  /** Paddle price id for the founding license. Set as a Cloudflare variable. */
  PADDLE_FOUNDING_PRICE_ID?: string;
};

const COMMERCE_DISABLED = {
  ok: false,
  code: "commerce_not_configured",
  message: "Cueport commerce endpoints are not configured for this deployment.",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhooks/paddle") {
      return handlePaddleWebhook(request, env);
    }

    if (url.pathname.startsWith("/license/")) {
      return json(COMMERCE_DISABLED, 503);
    }

    return serveSignedDownload(request, env, url);
  },
};

async function serveSignedDownload(request: Request, env: Env, url: URL): Promise<Response> {
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

  const valid = await verifyDownloadSignature(env.DOWNLOAD_SECRET, file, expires, signature);
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

async function handlePaddleWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed" }, 405);
  }

  if (!env.LICENSE_ENTITLEMENTS || !env.PADDLE_WEBHOOK_SECRET) {
    return json(COMMERCE_DISABLED, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("Paddle-Signature") || request.headers.get("paddle-signature") || "";
  const valid = await verifyPaddleSignature(env.PADDLE_WEBHOOK_SECRET, rawBody, signature);
  if (!valid) {
    return json({ ok: false, code: "invalid_signature" }, 401);
  }

  let event: PaddleWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaddleWebhookEvent;
  } catch {
    return json({ ok: false, code: "invalid_json" }, 400);
  }

  if (!event.event_id || !event.event_type) {
    return json({ ok: false, code: "invalid_event" }, 400);
  }

  const providerObjectId = providerObjectIdFor(event);
  await env.LICENSE_ENTITLEMENTS.prepare(
    `INSERT OR IGNORE INTO commerce_events
      (event_id, event_type, provider, provider_object_id, payload_json, received_at)
     VALUES (?1, ?2, 'paddle', ?3, ?4, unixepoch())`
  )
    .bind(event.event_id, event.event_type, providerObjectId, rawBody)
    .run();

  const inserted = await env.LICENSE_ENTITLEMENTS.prepare(
    `SELECT event_id FROM commerce_events WHERE event_id = ?1`
  )
    .bind(event.event_id)
    .first<{ event_id: string }>();

  if (!inserted) {
    return json({ ok: false, code: "event_record_failed" }, 500);
  }

  if (event.event_type === "transaction.completed") {
    await recordCompletedTransaction(env, event);
  } else if (event.event_type === "adjustment.created" || event.event_type === "adjustment.updated") {
    await recordAdjustment(env, event);
  }

  return json({ ok: true });
}

async function recordCompletedTransaction(env: Env, event: PaddleWebhookEvent): Promise<void> {
  const transaction = event.data;
  if (!transaction?.id) return;

  const priceId = firstPriceId(transaction);
  if (env.PADDLE_FOUNDING_PRICE_ID && priceId !== env.PADDLE_FOUNDING_PRICE_ID) {
    return;
  }

  const purchaseDate = dateOnly(transaction.billed_at || transaction.created_at || event.occurred_at) ?? today();
  const updatesUntil = addMonths(purchaseDate, 12);
  const entitlementId = `paddle:${transaction.id}`;

  await env.LICENSE_ENTITLEMENTS!.prepare(
    `INSERT INTO license_entitlements
      (entitlement_id, provider, provider_transaction_id, provider_customer_id, provider_price_id,
       email, status, updates_until, update_source, created_at, updated_at)
     VALUES (?1, 'paddle', ?2, ?3, ?4, ?5, 'pending_delivery', ?6, 'paid', unixepoch(), unixepoch())
     ON CONFLICT(provider_transaction_id) DO UPDATE SET
       provider_customer_id = COALESCE(excluded.provider_customer_id, license_entitlements.provider_customer_id),
       provider_price_id = COALESCE(excluded.provider_price_id, license_entitlements.provider_price_id),
       email = COALESCE(excluded.email, license_entitlements.email),
       updated_at = unixepoch()`
  )
    .bind(
      entitlementId,
      transaction.id,
      transaction.customer_id ?? null,
      priceId,
      transaction.customer?.email ?? null,
      updatesUntil
    )
    .run();
}

async function recordAdjustment(env: Env, event: PaddleWebhookEvent): Promise<void> {
  const adjustment = event.data;
  if (!adjustment?.transaction_id || adjustment.action !== "refund") return;
  if (adjustment.status !== "approved") return;

  await env.LICENSE_ENTITLEMENTS!.prepare(
    `UPDATE license_entitlements
     SET status = 'refunded', updated_at = unixepoch()
     WHERE provider = 'paddle' AND provider_transaction_id = ?1`
  )
    .bind(adjustment.transaction_id)
    .run();
}

function providerObjectIdFor(event: PaddleWebhookEvent): string | null {
  return event.data?.id || event.data?.transaction_id || null;
}

function firstPriceId(data: PaddleEventData): string | null {
  const items = data.items || data.details?.line_items || [];
  for (const item of items) {
    const id = item.price?.id || item.price_id;
    if (id) return id;
  }
  return null;
}

async function verifyDownloadSignature(
  secret: string,
  file: string,
  expires: string,
  received: string
): Promise<boolean> {
  const expected = await signDownload(secret, file, expires);
  return timingSafeEqual(expected, received);
}

async function verifyPaddleSignature(secret: string, rawBody: string, header: string): Promise<boolean> {
  const parsed = parsePaddleSignature(header);
  if (!parsed.ts || parsed.h1.length === 0) return false;

  const timestampMs = Number(parsed.ts) * 1000;
  const skewMs = Math.abs(Date.now() - timestampMs);
  if (!Number.isFinite(skewMs) || skewMs > 5000) return false;

  const expected = await hmacHex(secret, `${parsed.ts}:${rawBody}`);
  return parsed.h1.some((candidate) => timingSafeEqual(expected, candidate.toLowerCase()));
}

function parsePaddleSignature(header: string): { ts: string | null; h1: string[] } {
  const result: { ts: string | null; h1: string[] } = { ts: null, h1: [] };
  for (const part of header.split(";")) {
    const [key, value] = part.split("=");
    if (key === "ts" && value) result.ts = value;
    if (key === "h1" && value) result.h1.push(value);
  }
  return result;
}

async function signDownload(secret: string, file: string, expires: string): Promise<string> {
  const signature = await hmacBytes(secret, `${file}.${expires}`);
  return base64Url(signature);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  return hex(await hmacBytes(secret, value));
}

async function hmacBytes(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function addMonths(dateOnlyValue: string, months: number): string {
  const date = new Date(`${dateOnlyValue}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

type PaddleWebhookEvent = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: PaddleEventData;
};

type PaddleEventData = {
  id?: string;
  transaction_id?: string;
  customer_id?: string | null;
  customer?: {
    email?: string | null;
  } | null;
  action?: string;
  status?: string;
  billed_at?: string | null;
  created_at?: string | null;
  items?: Array<PaddleLineItem>;
  details?: {
    line_items?: Array<PaddleLineItem>;
  } | null;
};

type PaddleLineItem = {
  price_id?: string | null;
  price?: {
    id?: string | null;
  } | null;
};
