# usecueport.com

Marketing site for Cueport, the DJ desktop and mobile app. Built with [Eleventy](https://www.11ty.dev/).

## Develop

```bash
npm install
npm start
```

The site runs at `http://localhost:8090`.

## Build

```bash
npm run build
```

Output goes to `_site/`.

## Structure

- `src/_data/site.json`: site-wide content (name, description, nav, social links).
- `src/_data/product.json`: app availability and download URLs. The homepage
  download button, the structured data, and `llms.txt` read from this file.
  The build prints a `[product]` warning for each app marked available without
  a `downloadUrl`. When an app ships, set its `downloadUrl` here.
- `src/_data/faq.json`: Support questions and answers.
- `src/_data/howItWorks.json`: How it works steps.
- `src/_data/edition.json`: Page order and folios (A1, A2, A3) for the header
  page number and the footer page strip. Add a page here to give it a folio.
- `src/_includes/layouts/base.njk`: base HTML layout and schema.org structured
  data (organization, app, and FAQ on the Support page).
- `src/_includes/partials/`: header, footer, and homepage partials.
- `src/index.njk`: home page.
- `src/how-it-works.njk`: How it works, rendered from `howItWorks.json`.
- `src/support.njk`: Support, rendered from `faq.json`.
- `src/llms.njk` and `src/llms-full.njk`: `/llms.txt` and `/llms-full.txt`,
  Markdown summaries for AI agents generated from the same data files.
- `src/assets/css/style.css`: styles.

## Deploy

Any static host works. The `_site` folder is the build output. Suggested options are Netlify, Cloudflare Pages, or GitHub Pages.
