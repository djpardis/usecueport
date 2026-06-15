# usecueport.com

Marketing site for Cueport, the DJ desktop and mobile app. Built with [Eleventy](https://www.11ty.dev/).

## Develop

```bash
npm install
npm start
```

The site runs at `http://localhost:8080`.

## Build

```bash
npm run build
```

Output goes to `_site/`.

## Structure

- `src/_data/site.json` — site-wide content (name, tagline, nav, download links).
- `src/_includes/layouts/base.njk` — base HTML layout.
- `src/_includes/partials/` — header and footer.
- `src/index.njk` — home page.
- `src/download.njk` — platform downloads.
- `src/media.njk` — placeholder for videos, press, and assets (see TODO on the page).
- `src/support.njk` — FAQ and contact.
- `src/assets/css/style.css` — styles.

## Deploy

Any static host works. The `_site` folder is the build output. Suggested options are Netlify, Cloudflare Pages, or GitHub Pages.
