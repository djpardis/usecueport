#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const DEFAULT_BASE_URL = "https://download.usecueport.com/";
const DEFAULT_FILE = "Cueport_0.2.1_aarch64.dmg";
const DEFAULT_TTL_HOURS = 72;

const secret = process.env.CUEPORT_DOWNLOAD_SECRET || readSecretFromKeychain();
if (!secret) {
  console.error(
    "Set CUEPORT_DOWNLOAD_SECRET or add it to macOS Keychain as 'Cueport download links'."
  );
  process.exit(1);
}

const file = process.argv[2] || DEFAULT_FILE;
const ttlHours = Number(process.argv[3] || DEFAULT_TTL_HOURS);

if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
  console.error("TTL must be a positive number of hours.");
  process.exit(1);
}

const baseUrl = process.env.CUEPORT_DOWNLOAD_BASE_URL || DEFAULT_BASE_URL;
const expires = Math.floor(Date.now() / 1000 + ttlHours * 60 * 60);
const signature = createHmac("sha256", secret)
  .update(`${file}.${expires}`)
  .digest("base64url");

const url = new URL(baseUrl);
url.searchParams.set("file", file);
url.searchParams.set("expires", String(expires));
url.searchParams.set("signature", signature);

console.log(url.toString());

function readSecretFromKeychain() {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-w",
      "-s",
      "Cueport download links",
      "-a",
      "CUEPORT_DOWNLOAD_SECRET"
    ], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
