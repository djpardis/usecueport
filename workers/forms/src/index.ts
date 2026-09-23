type Env = {
  ACCESS_FORM_FORWARD_URL?: string;
  ACCESS_FORM_FORWARD_TOKEN?: string;
  ACCESS_FORM_ALLOWED_ORIGINS?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_EXPECTED_HOSTNAMES?: string;
};

type RequiredField = {
  name: string;
  label: string;
  maxLength: number;
};

type AccessRequest = {
  full_name: string;
  DJ_name: string;
  email: string;
  social_or_site: string;
  DJ_software: string;
  library_size: string;
};

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const DEFAULT_ALLOWED_ORIGINS = ["https://usecueport.com", "https://www.usecueport.com"];
const DEFAULT_TURNSTILE_ACTION = "access_request";
const HONEYPOT_FIELD = "website";

const REQUIRED_FIELDS: RequiredField[] = [
  { name: "full_name", label: "Name", maxLength: 120 },
  { name: "DJ_name", label: "DJ name", maxLength: 120 },
  { name: "email", label: "Email", maxLength: 254 },
  { name: "social_or_site", label: "Socials or website", maxLength: 240 },
  { name: "DJ_software", label: "Main DJ software", maxLength: 80 },
  { name: "library_size", label: "Library size", maxLength: 80 }
];

const DJ_SOFTWARE_OPTIONS = new Set([
  "Serato DJ Pro",
  "Rekordbox",
  "Traktor",
  "VirtualDJ",
  "Engine DJ",
  "Mixxx",
  "Other"
]);

const LIBRARY_SIZE_OPTIONS = new Set([
  "Under 500 tracks",
  "500 to 2,000 tracks",
  "2,000 to 10,000 tracks",
  "10,000+ tracks"
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = parseList(env.ACCESS_FORM_ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
    const origin = request.headers.get("origin");
    const corsOrigin = getAllowedOrigin(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      return corsOrigin
        ? new Response(null, { status: 204, headers: corsHeaders(corsOrigin) })
        : jsonResponse({ error: "Origin is not allowed." }, 403);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, corsOrigin, {
        allow: "POST, OPTIONS"
      });
    }

    if (!corsOrigin) {
      return jsonResponse({ error: "Origin is not allowed." }, 403);
    }

    if (!isAccessRequestPath(new URL(request.url).pathname)) {
      return jsonResponse({ error: "Not found." }, 404, corsOrigin);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!isFormContentType(contentType)) {
      return jsonResponse({ error: "Unsupported form encoding." }, 415, corsOrigin);
    }

    const formData = await request.formData();

    if (textValue(formData.get(HONEYPOT_FIELD)) !== "") {
      return jsonResponse({ ok: true }, 200, corsOrigin);
    }

    const validation = validateAccessRequest(formData);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400, corsOrigin);
    }

    if (env.TURNSTILE_SECRET) {
      const token = textValue(formData.get("cf-turnstile-response"));
      const turnstile = await verifyTurnstile(token, request, env);

      if (!turnstile.ok) {
        return jsonResponse({ error: turnstile.error }, 403, corsOrigin);
      }
    }

    if (!env.ACCESS_FORM_FORWARD_URL) {
      return jsonResponse({ error: "Form delivery is not configured." }, 503, corsOrigin);
    }

    const forwarded = await forwardAccessRequest(validation.data, env);
    if (!forwarded.ok) {
      console.error(JSON.stringify({ event: "access_form_forward_failed", status: forwarded.status }));
      return jsonResponse({ error: "Could not submit the form. Please try again." }, 502, corsOrigin);
    }

    return jsonResponse({ ok: true }, 200, corsOrigin);
  }
};

function isAccessRequestPath(pathname: string): boolean {
  return pathname === "/submit/access-request" || pathname === "/submit/access-request/";
}

function isFormContentType(contentType: string): boolean {
  return (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  );
}

function validateAccessRequest(formData: FormData):
  | { ok: true; data: AccessRequest }
  | { ok: false; error: string } {
  const missing = REQUIRED_FIELDS.filter((field) => textValue(formData.get(field.name)) === "");
  if (missing.length > 0) {
    return { ok: false, error: `Please complete ${formatFieldList(missing)}.` };
  }

  const tooLong = REQUIRED_FIELDS.find(
    (field) => textValue(formData.get(field.name)).length > field.maxLength
  );
  if (tooLong) {
    return { ok: false, error: `${tooLong.label} is too long.` };
  }

  const data: AccessRequest = {
    full_name: textValue(formData.get("full_name")),
    DJ_name: textValue(formData.get("DJ_name")),
    email: textValue(formData.get("email")),
    social_or_site: textValue(formData.get("social_or_site")),
    DJ_software: textValue(formData.get("DJ_software")),
    library_size: textValue(formData.get("library_size"))
  };

  if (!isEmail(data.email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  if (!DJ_SOFTWARE_OPTIONS.has(data.DJ_software)) {
    return { ok: false, error: "Please choose a listed DJ software option." };
  }

  if (!LIBRARY_SIZE_OPTIONS.has(data.library_size)) {
    return { ok: false, error: "Please choose a listed library size." };
  }

  return { ok: true, data };
}

function formatFieldList(fields: RequiredField[]): string {
  return fields.map((field) => field.label).join(", ");
}

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function verifyTurnstile(
  token: string,
  request: Request,
  env: Env
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || !env.TURNSTILE_SECRET) {
    return { ok: false, error: "Verification failed. Please try again." };
  }

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    idempotency_key: crypto.randomUUID()
  });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) {
    body.set("remoteip", ip);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const result = (await response.json().catch(() => ({}))) as TurnstileResult;
  if (!response.ok || result.success !== true) {
    console.warn(
      JSON.stringify({
        event: "turnstile_rejected",
        errors: result["error-codes"] || []
      })
    );
    return { ok: false, error: "Verification failed. Please try again." };
  }

  const expectedAction = env.TURNSTILE_EXPECTED_ACTION || DEFAULT_TURNSTILE_ACTION;
  if (result.action !== expectedAction) {
    return { ok: false, error: "Verification failed. Please try again." };
  }

  const expectedHostnames = parseList(env.TURNSTILE_EXPECTED_HOSTNAMES);
  if (expectedHostnames.length > 0 && !expectedHostnames.includes(result.hostname || "")) {
    return { ok: false, error: "Verification failed. Please try again." };
  }

  return { ok: true };
}

async function forwardAccessRequest(data: AccessRequest, env: Env): Promise<{ ok: boolean; status: number }> {
  const headers = new Headers({
    "content-type": "application/json"
  });
  if (env.ACCESS_FORM_FORWARD_TOKEN) {
    headers.set("authorization", `Bearer ${env.ACCESS_FORM_FORWARD_TOKEN}`);
  }

  const response = await fetch(env.ACCESS_FORM_FORWARD_URL || "", {
    method: "POST",
    headers,
    body: JSON.stringify({
      form: "access-request",
      submitted_at: new Date().toISOString(),
      data
    })
  });

  return { ok: response.ok, status: response.status };
}

function parseList(value: string | undefined, fallback: string[] = []): string[] {
  const source = value && value.trim() ? value.split(",") : fallback;
  return source.map((item) => item.trim()).filter(Boolean);
}

function getAllowedOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) {
    return null;
  }
  return allowedOrigins.includes(origin) ? origin : null;
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
}

function jsonResponse(
  body: unknown,
  status: number,
  corsOrigin?: string | null,
  extraHeaders?: Record<string, string>
): Response {
  const headers = corsOrigin ? corsHeaders(corsOrigin) : new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders || {})) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(body), { status, headers });
}
