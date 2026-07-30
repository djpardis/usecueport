#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const FONT_DIR = "/Users/djpardis/Documents/talk1/public/fonts";
const OUT_PNG = "src/assets/img/og.png";
const W = 1200;
const H = 630;

function b64(file) {
  return readFileSync(`${FONT_DIR}/${file}`).toString("base64");
}

const dmSans700 = b64("DMSans-700.woff2");
const dmSans500 = b64("DMSans-500.woff2");
const dmMono400 = b64("DMMono-400.woff2");
const logoSvg = readFileSync("src/assets/img/logo-transparent.svg", "utf8");

// Replicates the talk1 closing slide exactly:
// same font sizes, same logo size, same layout padding, same gap —
// but centered (no QR column) and the conference footer replaced with the tagline.
const html = `<!DOCTYPE html>
<html><head>
<style>
  @font-face {
    font-family: "DM Sans";
    font-weight: 700;
    src: url("data:font/woff2;base64,${dmSans700}") format("woff2");
  }
  @font-face {
    font-family: "DM Sans";
    font-weight: 500;
    src: url("data:font/woff2;base64,${dmSans500}") format("woff2");
  }
  @font-face {
    font-family: "DM Mono";
    font-weight: 400;
    src: url("data:font/woff2;base64,${dmMono400}") format("woff2");
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${W}px;
    height: ${H}px;
    overflow: hidden;
  }
  /* Matches .slidev-layout */
  body {
    background: #f5ede0;
    font-family: "DM Sans", system-ui, sans-serif;
    font-size: 1.55rem;
    color: #18181b;
    padding: 3rem 4.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /* Matches the left column of the closing slide, centered */
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    text-align: center;
  }
  .logo svg {
    width: 140px;
    height: 140px;
    display: block;
  }
  /* Matches font-size:2.6rem; font-weight:700 from the slide div */
  .title {
    font-size: 2.6rem;
    font-weight: 700;
    color: #18181b;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  /* Matches font-size:1.5rem; line-height:1.4 from the slide div */
  .subtitle {
    font-size: 1.5rem;
    line-height: 1.4;
    color: #18181b;
  }
  /* Replaces the conference footer — same position as .slidev-layout::before */
  .tagline {
    font-family: "DM Mono", monospace;
    font-size: 0.9rem;
    font-weight: 500;
    color: #c2410c;
    letter-spacing: 0.12em;
    position: absolute;
    bottom: 1.4rem;
    left: 0;
    right: 0;
    text-align: center;
  }
</style>
</head><body>
  <div class="card">
    <div class="logo">${logoSvg}</div>
    <div class="title">Cueport</div>
    <div class="subtitle">A local-first music player for DJs</div>
  </div>
  <div class="tagline">LOCAL-FIRST \u00b7 DESKTOP + MOBILE</div>
</body></html>`;

const htmlPath = "/tmp/og-render.html";
writeFileSync(htmlPath, html);

const outAbs = resolve(OUT_PNG);
const script = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: ${W}, height: ${H}, deviceScaleFactor: 2 });
  await page.goto('file://${htmlPath}', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: '${outAbs}',
    type: 'png',
    clip: { x: 0, y: 0, width: ${W}, height: ${H} }
  });
  await browser.close();
  console.log('wrote ${outAbs}');
})();
`;

writeFileSync("/tmp/og-puppeteer.cjs", script);
execSync("node /tmp/og-puppeteer.cjs", { cwd: process.cwd(), stdio: "inherit" });
