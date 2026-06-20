#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FROM = "Cueport <hello@usecueport.com>";
const DEFAULT_FILE = "Cueport_0.2.1_aarch64.dmg";
const DEFAULT_TTL_HOURS = 72;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [to, name = "there", file = DEFAULT_FILE, ttl = String(DEFAULT_TTL_HOURS)] = process.argv.slice(2);

if (!to) {
  console.error("Usage: npm run email:send-access -- recipient@example.com \"Name\" [file] [ttlHours]");
  process.exit(1);
}

const resendApiKey = process.env.RESEND_API_KEY || readSecretFromKeychain();
if (!resendApiKey) {
  console.error("Set RESEND_API_KEY or store it in macOS Keychain as 'Cueport Resend API key'.");
  process.exit(1);
}

const html = execFileSync(
  "node",
  [join(root, "scripts/render-access-email.mjs"), name, file, ttl],
  { encoding: "utf8" }
);

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${resendApiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    from: FROM,
    to: [to],
    subject: "Your Cueport access",
    html
  })
});

if (!response.ok) {
  console.error("Resend rejected the email:");
  console.error(await response.text());
  process.exit(1);
}

const body = await response.json();
console.log(`Sent Cueport access email to ${to}.`);
console.log(`Resend id: ${body.id}`);

function readSecretFromKeychain() {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-w",
      "-s",
      "Cueport Resend API key",
      "-a",
      "RESEND_API_KEY"
    ], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
