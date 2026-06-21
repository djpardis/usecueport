#!/usr/bin/env node
/**
 * Cueport release script.
 *
 * Usage:
 *   node scripts/release.mjs <version> <path-to-dmg>
 *   node scripts/release.mjs 0.3.0 ~/Desktop/Cueport_0.3.0_aarch64.dmg
 *
 * What it does:
 *   1. Validates the version and DMG path.
 *   2. Updates src/_data/site.json (version, dmgFilename).
 *   3. Uploads the DMG to the cueport-downloads R2 bucket.
 *   4. Updates CURRENT_DMG in wrangler.downloads.toml.
 *   5. Deploys the downloads worker so the new filename is live.
 *   6. Prints a checklist of the remaining manual steps.
 *
 * Prerequisites:
 *   - wrangler authenticated (npx wrangler whoami)
 *   - R2 bucket "cueport-downloads" exists
 *   - DOWNLOAD_SECRET set as a wrangler secret on the cueport-downloads worker
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const siteDataPath = join(root, "src/_data/site.json");
const wranglerPath = join(root, "wrangler.downloads.toml");

const [version, dmgArg] = process.argv.slice(2);

if (!version || !dmgArg) {
  console.error("Usage: node scripts/release.mjs <version> <path-to-dmg>");
  console.error("  e.g. node scripts/release.mjs 0.3.0 ~/Desktop/Cueport_0.3.0_aarch64.dmg");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version}". Use semver format: 0.3.0`);
  process.exit(1);
}

const dmgPath = resolve(dmgArg.replace(/^~/, process.env.HOME));
if (!existsSync(dmgPath)) {
  console.error(`DMG not found: ${dmgPath}`);
  process.exit(1);
}

const dmgFilename = basename(dmgPath);
const expectedFilename = `Cueport_${version}_aarch64.dmg`;
if (dmgFilename !== expectedFilename) {
  console.warn(`Warning: DMG filename is "${dmgFilename}", expected "${expectedFilename}".`);
  console.warn("Continuing with the actual filename.");
}

// ── 1. Update site.json ───────────────────────────────────────────────────

console.log(`\nUpdating site.json to version ${version}...`);
const site = JSON.parse(readFileSync(siteDataPath, "utf8"));
site.version = version;
site.dmgFilename = dmgFilename;
writeFileSync(siteDataPath, JSON.stringify(site, null, 2) + "\n");
console.log("  site.json updated.");

// ── 2. Upload DMG to R2 ───────────────────────────────────────────────────

console.log(`\nUploading ${dmgFilename} to R2 bucket cueport-downloads...`);
run("npx", [
  "wrangler", "r2", "object", "put",
  `cueport-downloads/${dmgFilename}`,
  "--file", dmgPath,
  "--content-type", "application/x-apple-diskimage",
  "--config", wranglerPath,
]);
console.log("  Upload complete.");

// ── 3. Update wrangler.downloads.toml CURRENT_DMG ────────────────────────

console.log("\nUpdating wrangler.downloads.toml...");
let toml = readFileSync(wranglerPath, "utf8");
toml = toml.replace(
  /^CURRENT_DMG\s*=\s*".*?"$/m,
  `CURRENT_DMG = "${dmgFilename}"`
);
writeFileSync(wranglerPath, toml);
console.log("  wrangler.downloads.toml updated.");

// ── 4. Deploy the downloads worker ───────────────────────────────────────

console.log("\nDeploying downloads worker...");
run("npx", ["wrangler", "deploy", "--config", wranglerPath]);
console.log("  Worker deployed.");

// ── 5. Print remaining manual steps ──────────────────────────────────────

console.log(`
Done. Remaining steps:

  [ ] Build and sign the Mac app in the dj repo:
        cd apps/desktop && npm run tauri build

  [ ] Update shipNotes in site.json if the text needs changing, then:
        cd ${root}
        git add src/_data/site.json wrangler.downloads.toml
        git commit -m "Release ${version}"
        git push

  [ ] Verify the download worker serves the new file:
        npm run download:link
        # open the printed URL in a browser and confirm the DMG downloads

  [ ] Send access emails to the waitlist:
        npm run email:send-access -- recipient@example.com "Name"
`);

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "inherit", cwd: root });
  } catch (e) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}
