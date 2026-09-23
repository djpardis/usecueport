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

## Access form

The download page posts access requests to the protected form Worker at
`https://form.usecueport.com/submit/access-request`. The browser form marks
every user-facing field as required, and the Worker repeats those checks before
delivery so direct POSTs cannot skip validation.

The Worker accepts requests only from configured site origins, rejects the
hidden honeypot field, validates the email address and select values, and can
verify Cloudflare Turnstile tokens when a secret is configured. Turnstile is
optional in source control because the public site key and private secret are
operator configuration.

Configure delivery and optional Turnstile protection with Worker secrets:

```bash
npx wrangler secret put ACCESS_FORM_FORWARD_URL --config wrangler.forms.toml
npx wrangler secret put ACCESS_FORM_FORWARD_TOKEN --config wrangler.forms.toml
npx wrangler secret put TURNSTILE_SECRET --config wrangler.forms.toml
```

`ACCESS_FORM_FORWARD_URL` is required in production. The token and Turnstile
secret are optional, but setting `TURNSTILE_SECRET` makes server-side Turnstile
verification mandatory for submissions. Add `site.forms.access.turnstileSiteKey`
in `src/_data/site.json` when a Turnstile widget should be rendered on the
download page.

Deploy the form Worker with:

```bash
npm run forms:deploy
```

## Structure

- `src/_data/site.json`: site-wide content (name, tagline, nav, download links).
- `src/_includes/layouts/base.njk`: base HTML layout.
- `src/_includes/partials/`: header and footer.
- `src/index.njk`: home page.
- `src/download.njk`: platform downloads.
- `workers/forms/src/index.ts`: protected access form receiver.
- `src/media.njk`: placeholder for videos, press, and assets (see TODO on the page).
- `src/support.njk`: FAQ and contact.
- `src/assets/css/style.css`: styles.

## Deploy

Any static host works. The `_site` folder is the build output. Suggested options are Netlify, Cloudflare Pages, or GitHub Pages.
