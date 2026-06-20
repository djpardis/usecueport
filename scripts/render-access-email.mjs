#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = "Cueport_0.2.1_aarch64.dmg";
const DEFAULT_TTL_HOURS = 72;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const name = process.argv[2] || "there";
const file = process.argv[3] || DEFAULT_FILE;
const ttlHours = Number(process.argv[4] || DEFAULT_TTL_HOURS);

if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
  console.error("TTL must be a positive number of hours.");
  process.exit(1);
}

const downloadUrl = execFileSync(
  "node",
  [join(root, "scripts/generate-download-link.mjs"), file, String(ttlHours)],
  { encoding: "utf8" }
).trim();

const expiresAfter = formatDuration(ttlHours);

const html = readFileSync(join(root, "emails/access-approved.html"), "utf8")
  .replaceAll("{{name}}", escapeHtml(name))
  .replaceAll("{{download_url}}", escapeHtml(downloadUrl))
  .replaceAll("{{expires_after}}", escapeHtml(expiresAfter));

console.log(html);

function formatDuration(hours) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
