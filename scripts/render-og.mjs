#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const FONT_DIR = "/Users/djpardis/Documents/talk1/public/fonts";
const DESKTOP_ORIG = "/Users/djpardis/.cursor/projects/Users-djpardis-Documents-usecueport/assets/Screenshot_2026-07-30_at_10.11.53_AM-6378391c-a354-4306-bd6d-fe896ce983cc.png";
const MOBILE_ORIG  = "/Users/djpardis/.cursor/projects/Users-djpardis-Documents-usecueport/assets/IMG_2524-55c0be5e-25fd-4040-95d1-e05473a07d47.png";
const OUT_PNG = resolve("src/assets/img/og.png");
const W = 1200;
const H = 630;

function b64file(path) {
  return readFileSync(path).toString("base64");
}

const dmSans700 = b64file(`${FONT_DIR}/DMSans-700.woff2`);
const dmSans500 = b64file(`${FONT_DIR}/DMSans-500.woff2`);
const dmMono400 = b64file(`${FONT_DIR}/DMMono-400.woff2`);
const dmMono500 = b64file(`${FONT_DIR}/DMMono-500.woff2`);
const desktopB64 = b64file(DESKTOP_ORIG);
const mobileB64  = b64file(MOBILE_ORIG);
const logoSvg = readFileSync("src/assets/img/logo-transparent.svg", "utf8");

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  @font-face { font-family:"DM Sans";  font-weight:700; src:url("data:font/woff2;base64,${dmSans700}") format("woff2"); }
  @font-face { font-family:"DM Sans";  font-weight:500; src:url("data:font/woff2;base64,${dmSans500}") format("woff2"); }
  @font-face { font-family:"DM Mono";  font-weight:400; src:url("data:font/woff2;base64,${dmMono400}") format("woff2"); }
  @font-face { font-family:"DM Mono";  font-weight:500; src:url("data:font/woff2;base64,${dmMono500}") format("woff2"); }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    background: #f5ede0;
    font-family: "DM Sans", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    position: relative;
    display: flex;
    align-items: stretch;
    /* right padding keeps a clean margin; mobile stays inside */
    padding-right: 36px;
  }

  /* Left panel: logo + wordmark + subtitle, vertically centered */
  .left {
    flex: 0 0 310px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 16px;
    padding: 40px 32px 60px 44px;
  }
  .logo svg { width: 130px; height: 130px; display: block; }
  .wordmark {
    font-size: 64px;
    font-weight: 700;
    color: #18181b;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .subtitle {
    font-size: 17px;
    font-weight: 500;
    color: #52525b;
    line-height: 1.4;
    white-space: nowrap;
    text-align: center;
  }

  /* Right panel: screenshots */
  .right {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
    padding: 16px 0 20px 0;
  }
  .desktop {
    width: calc(100% - 100px);
    height: auto;
    display: block;
    border-radius: 8px;
    box-shadow: 0 12px 48px rgba(24,24,27,0.18);
    margin-left: 40px;
    margin-top: -40px;
  }
  .mobile {
    position: absolute;
    bottom: 30px;
    right: 0;
    width: 195px;
    height: auto;
    display: block;
    filter: drop-shadow(0 12px 36px rgba(24,24,27,0.38));
    z-index: 10;
  }

  /* Tagline pinned to bottom center */
  .tagline {
    position: absolute;
    bottom: 20px;
    left: 0; right: 0;
    text-align: center;
    font-family: "DM Mono", monospace;
    font-size: 20px;
    font-weight: 500;
    color: #c2410c;
    letter-spacing: 0.2em;
    -webkit-text-stroke: 0.5px #c2410c;
  }
</style>
</head><body>
  <div class="left">
    <div class="logo">${logoSvg}</div>
    <div class="wordmark">Cueport</div>
    <div class="subtitle">A local-first music player for DJs</div>
  </div>
  <div class="right">
    <img class="desktop" src="data:image/png;base64,${desktopB64}" alt="">
    <img class="mobile"  src="data:image/png;base64,${mobileB64}" alt="">
  </div>
  <div class="tagline">LOCAL-FIRST \u00b7 DESKTOP + MOBILE</div>
</body></html>`;

const htmlPath = "/tmp/og-render.html";
writeFileSync(htmlPath, html);

const script = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: ${W}, height: ${H}, deviceScaleFactor: 2 });
  await page.goto('file://${htmlPath}', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '${OUT_PNG}', type: 'png', clip: { x:0, y:0, width:${W}, height:${H} } });
  await browser.close();
  console.log('wrote ${OUT_PNG}');
})();
`;
writeFileSync("/tmp/og-puppeteer.cjs", script);
execSync("node /tmp/og-puppeteer.cjs", { cwd: process.cwd(), stdio: "inherit" });
