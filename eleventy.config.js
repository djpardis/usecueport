const product = require("./src/_data/product.json");

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
