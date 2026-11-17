const product = require("./src/_data/product.json");
const releases = require("./src/_data/releases.json");
const site = require("./src/_data/site.json");

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripHtml = (html = "") => decodeEntities(String(html).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const htmlToMarkdown = (html = "") =>
  decodeEntities(
    String(html)
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)")
      .replace(/<(code|span class="mono")>(.*?)<\/(code|span)>/g, "`$2`")
      .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
      .replace(/<em>(.*?)<\/em>/g, "_$1_")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });
  eleventyConfig.addPassthroughCopy("src/CNAME");

  eleventyConfig.addFilter("year", () => new Date().getFullYear());
  eleventyConfig.addFilter("dateFormat", (d) => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString().split("T")[0];
  });
  eleventyConfig.addFilter("stripHtml", stripHtml);
  eleventyConfig.addFilter("markdown", htmlToMarkdown);
  eleventyConfig.addFilter("pageIndex", (pages, url) => pages.findIndex((p) => p.href === url));

  // product.json is the source of truth for app availability across the
  // homepage, structured data, and llms.txt. Flag apps that are marked
  // available but cannot be downloaded yet so the gap is visible at build time.
  eleventyConfig.on("eleventy.before", () => {
    for (const app of Object.values(product.apps)) {
      if (app.available && !app.downloadUrl) {
        console.warn(
          `[product] ${app.name} is marked available but has no downloadUrl in src/_data/product.json. ` +
            "Its download button and download links are omitted until a URL is set."
        );
      }
    }
    assertTrailMixReleaseNotesUseSiteData();
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};

function assertTrailMixReleaseNotesUseSiteData() {
  let trailMixItemCount = 0;
  for (const stream of releases.streams || []) {
    for (const entry of stream.entries || []) {
      for (const item of entry.items || []) {
        if (item.trailMixAnalysis) {
          trailMixItemCount += 1;
        }
        if (typeof item.text === "string" && item.text.includes("github.com/djpardis/trailmix/releases")) {
          throw new Error(
            "[releases] Trail mix release links must render from site.trailMix, not hardcoded release note text."
          );
        }
      }
    }
  }
  if (trailMixItemCount > 0 && (!site.trailMix?.version || !site.trailMix?.url)) {
    throw new Error("[releases] site.trailMix.version and site.trailMix.url are required for release notes.");
  }
}
