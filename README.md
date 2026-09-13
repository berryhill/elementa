# ELEMENTA

Next.js + TypeScript website for ELEMENTA ORIGINS 2027, with English and Spanish countdown pages, supplied brand artwork, atmospheric background, motion controls and an accessible signup dialog.

## Run locally

Node.js 22.22 or newer is recommended for the test runner.

```sh
npm ci
npm run build
npm run start -- --port 3107
```

Open http://localhost:3107/es or http://localhost:3107/en. For development, use `npm run dev`.

## Routes

- `/` redirects to `/es`.
- `/es` and `/en`: localized landing pages.
- `/es/credits` and `/en/credits`: photograph attribution and licensing.
- Invalid pages return HTTP 404 with recovery links.
- `/robots.txt` and `/sitemap.xml`: publication-stage discovery controls.

## Verification

```sh
npm run typecheck
npm test
# Install the test browser inside the project:
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npx playwright install chromium
# With the built server running on port 3107:
npm run test:browser
npm run test:a11y
ELEMENTA_TEST_ORIGIN=http://localhost:3107 node --test tests/http/not-found.test.mjs
```

Set `PREVIEW_URL` to use another server for browser/accessibility checks. Browser checks write local screenshots and results to `docs/verification/`.

## Publication and integration status

The application defaults to a **noindex preview**. A production build does not authorize indexing or public launch. `.env.example` documents the publication settings; the public-release guard remains closed until required integrations and approvals are supplied.

The signup dialog currently validates email and consent locally but does **not** submit or save addresses. Its response explicitly identifies this preview behavior. A selected subscriber provider/list, authorized integration access and approved privacy/unsubscribe terms are required for real enrollment. GA4 collection is not enabled.

Festival dates and the announcement instant are separate values in `src/content/festival.ts`. Current preview values must receive operational approval before launch. No artists, prices, venue address or available-ticket claims are invented. Event/Offer structured data remains deferred pending the necessary approved facts.

## Assets

The adapted Playa Venao photograph is credited on the localized credits pages under CC BY-SA 3.0. That license does not extend to ELEMENTA brand artwork or application code. Brand assets remain subject to their owners' rights.
