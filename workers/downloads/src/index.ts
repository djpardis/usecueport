type Env = {
  CUEPORT_DOWNLOADS: R2Bucket;
  DOWNLOAD_SECRET: string;
};

const DEFAULT_FILENAME = "Cueport_0.2.1_aarch64.dmg";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const file = url.searchParams.get("file") || DEFAULT_FILENAME;
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

async function verifySignature(
  secret: string,
  file: string,
  expires: string,
  received: string
): Promise<boolean> {
  const expected = await sign(secret, file, expires);
  return timingSafeEqual(expected, received);
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
