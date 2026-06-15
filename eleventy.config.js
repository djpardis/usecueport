module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });
  eleventyConfig.addPassthroughCopy("src/CNAME");

  eleventyConfig.addFilter("year", () => new Date().getFullYear());
  eleventyConfig.addFilter("dateFormat", (d) => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString().split("T")[0];
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
