type Env = {
  CUEPORT_DOWNLOADS: R2Bucket;
  DOWNLOAD_SECRET: string;
  /** Filename of the current release DMG, e.g. "Cueport_0.3.0_aarch64.dmg". Set via wrangler var. */
  CURRENT_DMG: string;
  /** Optional D1 binding for future Lemon Squeezy entitlements. Not required for public downloads. */
  LICENSE_ENTITLEMENTS?: D1Database;
  /** Lemon Squeezy webhook signing secret. Set only when licensing is enabled. */
  LEMON_SQUEEZY_WEBHOOK_SECRET?: string;
  /** Expected Lemon Squeezy store id for Cueport licenses. */
  LEMON_SQUEEZY_STORE_ID?: string;
  /** Expected Lemon Squeezy product id for Cueport desktop licenses. */
  LEMON_SQUEEZY_PRODUCT_ID?: string;
  /** Comma-separated variant ids that should receive comped-founder treatment. */
  LEMON_SQUEEZY_BETA_VARIANT_IDS?: string;
  /** Paid public launch date, YYYY-MM-DD. Used to start comped founder update windows. */
  CUEPORT_PAID_LAUNCH_DATE?: string;
};

const UPDATE_ENTITLEMENT_MONTHS = 12;

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

  if (!isLicensingConfigured(env)) {
    return json(LICENSING_DISABLED, 503);
  }

  if (url.pathname === "/license/activate") {
    return activateLicense(request, env);
  }

  if (url.pathname === "/license/validate") {
    return validateLicense(request, env);
  }

  return json({ ok: false, code: "not_found" }, 404);
}

async function activateLicense(request: Request, env: Env): Promise<Response> {
  const input = await readJson<ActivationRequest>(request);
  if (!input.ok) return input.response;

  const licenseKey = input.value.licenseKey?.trim();
  const instanceName = input.value.instanceName?.trim();
  if (!licenseKey || !instanceName) {
    return json({ ok: false, code: "missing_activation_fields" }, 400);
  }

  const lemon = await callLemonLicenseApi("activate", {
    license_key: licenseKey,
    instance_name: instanceName,
  });

  if (!lemon.ok) {
    return json({ ok: false, code: "lemon_squeezy_error", error: lemon.error }, 502);
  }

  if (!lemon.data.activated || !lemon.data.instance?.id) {
    return json({
      ok: false,
      code: "activation_rejected",
      error: lemon.data.error ?? null,
      licenseStatus: lemon.data.license_key?.status ?? null,
    }, 403);
  }

  const productCheck = verifyLemonProduct(env, lemon.data.meta);
  if (!productCheck.ok) {
    return json({ ok: false, code: productCheck.code }, 403);
  }

  const entitlement = await upsertEntitlement(env, licenseKey, lemon.data, input.value.email ?? null);
  await env.LICENSE_ENTITLEMENTS!.prepare(
    `INSERT OR REPLACE INTO license_instances
      (instance_id, license_key_hash, instance_name, status, activated_at, last_validated_at, deactivated_at)
     VALUES (?1, ?2, ?3, 'active', unixepoch(), unixepoch(), NULL)`
  )
    .bind(lemon.data.instance.id, entitlement.licenseKeyHash, lemon.data.instance.name ?? instanceName)
    .run();

  return json({
    ok: true,
    state: entitlement.status,
    instanceId: lemon.data.instance.id,
    updatesUntil: entitlement.updatesUntil,
    updateSource: entitlement.updateSource,
    activationLimit: lemon.data.license_key?.activation_limit ?? null,
    activationUsage: lemon.data.license_key?.activation_usage ?? null,
    appCanRun: entitlement.status !== "disabled",
    updatesAvailable: entitlement.status === "active",
  });
}

async function validateLicense(request: Request, env: Env): Promise<Response> {
  const input = await readJson<ValidationRequest>(request);
  if (!input.ok) return input.response;

  const licenseKey = input.value.licenseKey?.trim();
  if (!licenseKey) {
    return json({ ok: false, code: "missing_license_key" }, 400);
  }

  const params: Record<string, string> = { license_key: licenseKey };
  if (input.value.instanceId?.trim()) params.instance_id = input.value.instanceId.trim();

  const lemon = await callLemonLicenseApi("validate", params);
  if (!lemon.ok) {
    return json({ ok: false, code: "lemon_squeezy_error", error: lemon.error }, 502);
  }

  if (!lemon.data.valid) {
    return json({
      ok: false,
      code: "license_invalid",
      error: lemon.data.error ?? null,
      licenseStatus: lemon.data.license_key?.status ?? null,
    }, 403);
  }

  const productCheck = verifyLemonProduct(env, lemon.data.meta);
  if (!productCheck.ok) {
    return json({ ok: false, code: productCheck.code }, 403);
  }

  const entitlement = await upsertEntitlement(env, licenseKey, lemon.data, input.value.email ?? null);
  if (input.value.instanceId?.trim()) {
    await env.LICENSE_ENTITLEMENTS!.prepare(
      `UPDATE license_instances
       SET last_validated_at = unixepoch()
       WHERE instance_id = ?1 AND license_key_hash = ?2`
    )
      .bind(input.value.instanceId.trim(), entitlement.licenseKeyHash)
      .run();
  }

  return json({
    ok: Boolean(lemon.data.valid),
    state: entitlement.status,
    updatesUntil: entitlement.updatesUntil,
    updateSource: entitlement.updateSource,
    appCanRun: entitlement.status !== "disabled",
    updatesAvailable: entitlement.status === "active",
    licenseStatus: lemon.data.license_key?.status ?? null,
    instanceId: lemon.data.instance?.id ?? input.value.instanceId ?? null,
  });
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

async function callLemonLicenseApi(
  action: "activate" | "validate",
  params: Record<string, string>
): Promise<{ ok: true; data: LemonLicenseResponse } | { ok: false; error: string }> {
  const body = new URLSearchParams(params);
  const response = await fetch(`https://api.lemonsqueezy.com/v1/licenses/${action}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let data: LemonLicenseResponse;
  try {
    data = await response.json() as LemonLicenseResponse;
  } catch {
    return { ok: false, error: `Lemon Squeezy returned HTTP ${response.status}` };
  }

  if (!response.ok) {
    return { ok: false, error: data.error ?? `Lemon Squeezy returned HTTP ${response.status}` };
  }
  return { ok: true, data };
}

async function upsertEntitlement(
  env: Env,
  licenseKey: string,
  lemon: LemonLicenseResponse,
  providedEmail: string | null
): Promise<{ licenseKeyHash: string; status: EntitlementStatus; updatesUntil: string; updateSource: UpdateSource }> {
  const licenseKeyHash = await sha256Hex(licenseKey);
  const variantId = String(lemon.meta?.variant_id ?? "");
  const updateSource: UpdateSource = csvIncludes(env.LEMON_SQUEEZY_BETA_VARIANT_IDS, variantId)
    ? "comped_founder"
    : "paid";
  const status = entitlementStatusFor(lemon);
  const paidLaunchDate = dateOnly(env.CUEPORT_PAID_LAUNCH_DATE);
  const updatesStart = updateSource === "comped_founder" && paidLaunchDate
    ? paidLaunchDate
    : dateOnly(lemon.license_key?.created_at) ?? today();
  const updatesUntil = addMonths(updatesStart, UPDATE_ENTITLEMENT_MONTHS);
  const email = providedEmail || lemon.meta?.customer_email || null;

  await env.LICENSE_ENTITLEMENTS!.prepare(
    `INSERT INTO license_entitlements
      (license_key_hash, lemon_license_id, lemon_customer_id, lemon_order_id, email, status,
       updates_until, update_source, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch(), unixepoch())
     ON CONFLICT(license_key_hash) DO UPDATE SET
       lemon_license_id = excluded.lemon_license_id,
       lemon_customer_id = excluded.lemon_customer_id,
       lemon_order_id = excluded.lemon_order_id,
       email = COALESCE(excluded.email, license_entitlements.email),
       status = CASE
         WHEN license_entitlements.status IN ('refunded', 'chargeback') THEN license_entitlements.status
         ELSE excluded.status
       END,
       updates_until = COALESCE(license_entitlements.updates_until, excluded.updates_until),
       update_source = license_entitlements.update_source,
       updated_at = unixepoch()`
  )
    .bind(
      licenseKeyHash,
      lemon.license_key?.id ? String(lemon.license_key.id) : null,
      lemon.meta?.customer_id ? String(lemon.meta.customer_id) : null,
      lemon.meta?.order_id ? String(lemon.meta.order_id) : null,
      email,
      status,
      updatesUntil,
      updateSource
    )
    .run();

  const row = await env.LICENSE_ENTITLEMENTS!.prepare(
    `SELECT status, updates_until, update_source
     FROM license_entitlements
     WHERE license_key_hash = ?1`
  )
    .bind(licenseKeyHash)
    .first<{ status: EntitlementStatus; updates_until: string; update_source: UpdateSource }>();

  return {
    licenseKeyHash,
    status: row?.status ?? status,
    updatesUntil: row?.updates_until ?? updatesUntil,
    updateSource: row?.update_source ?? updateSource,
  };
}

function verifyLemonProduct(
  env: Env,
  meta: LemonLicenseResponse["meta"]
): { ok: true } | { ok: false; code: string } {
  if (!meta) return { ok: false, code: "missing_license_metadata" };
  if (String(meta.store_id) !== env.LEMON_SQUEEZY_STORE_ID) {
    return { ok: false, code: "wrong_store" };
  }
  if (String(meta.product_id) !== env.LEMON_SQUEEZY_PRODUCT_ID) {
    return { ok: false, code: "wrong_product" };
  }
  return { ok: true };
}

function entitlementStatusFor(lemon: LemonLicenseResponse): EntitlementStatus {
  return lemon.license_key?.status === "disabled" ? "disabled" : "active";
}

function isLicensingConfigured(env: Env): boolean {
  return Boolean(env.LICENSE_ENTITLEMENTS && env.LEMON_SQUEEZY_STORE_ID && env.LEMON_SQUEEZY_PRODUCT_ID);
}

async function readJson<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() as T };
  } catch {
    return { ok: false, response: json({ ok: false, code: "invalid_json" }, 400) };
  }
}

function csvIncludes(csv: string | undefined, value: string): boolean {
  return Boolean(value && csv?.split(",").map((item) => item.trim()).includes(value));
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

type ActivationRequest = {
  licenseKey?: string;
  instanceName?: string;
  email?: string;
};

type ValidationRequest = {
  licenseKey?: string;
  instanceId?: string;
  email?: string;
};

type EntitlementStatus = "active" | "refunded" | "chargeback" | "disabled";
type UpdateSource = "paid" | "comped_founder" | "renewal";

type LemonLicenseResponse = {
  activated?: boolean;
  valid?: boolean;
  error?: string | null;
  license_key?: {
    id?: number | string;
    status?: string;
    activation_limit?: number | null;
    activation_usage?: number | null;
    created_at?: string;
    expires_at?: string | null;
  };
  instance?: {
    id?: string;
    name?: string;
    created_at?: string;
  } | null;
  meta?: {
    store_id?: number | string;
    order_id?: number | string;
    order_item_id?: number | string;
    product_id?: number | string;
    product_name?: string;
    variant_id?: number | string;
    variant_name?: string;
    customer_id?: number | string;
    customer_name?: string;
    customer_email?: string;
  };
};
