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

The signup dialog sends JSON to `POST /api/signup`. It reports success only after an acknowledged MongoDB write. Missing configuration or database failures return a generic error; the form retains the address for retry. GA4 collection is not enabled. Subscriber storage is implemented; email delivery, unsubscribe handling and an owner-approved full privacy/retention policy are still launch prerequisites.

## Signup operations

- Set server-only `MONGODB_URI` using an untracked `.env.local` locally or an existing authorized deployment Secret. No connection is opened during build: the official driver lazily reuses a small process-level pool, including development reloads.
- Database is always `elementa`, collection `subscribers`, regardless of the URI default database. Grant only the necessary access to that database. The normalized (trimmed, lowercase) email is the unique `_id`; atomic `$setOnInsert` upserts preserve the first signup's email, locale, `consent: true`, `consentVersion: elementa-updates-v1`, and `createdAt`. Repeat submissions succeed without inserting another subscriber or changing the original consent evidence. No IP is stored by this code. `_id` contains personal data and must be protected like email.
- Set `SIGNUP_ALLOWED_ORIGIN` to the exact approved browser-facing origin behind ingress (no trailing slash). Without it, Origin must equal the request URL origin. Forwarded headers are not used to authorize requests; configure ingress to sanitize Host/forwarding headers. Missing or cross-origin Origin is rejected. Only JSON with exactly email, locale (`es`/`en`), and consent (`true`) is accepted, with a streamed 2 KiB body limit and conservative ASCII email validation.
- Required before public exposure: configure edge/ingress rate limiting for POST `/api/signup` (for example an initial 5 requests/minute per client with a small burst, adjusted to actual traffic), a global traffic/concurrency cap, body/header read deadlines and a 2 KiB request limit. Return 429 on throttling. Same-origin checks are not bot protection; this application intentionally makes no distributed rate-limit guarantee. Do not expose the origin around these controls. Avoid request-body/email logging at the edge and review access-log IP retention separately.
- The browser times out after 12 seconds and cancels UI updates on close/unmount. Cancellation does not guarantee cancellation of a database write; retries are safe. Majority acknowledgement is required, but an ambiguous timeout may mean a write completed: errors say the subscription could not be confirmed, not that nothing was stored.

Deployment owner wiring example (documentation only; replace placeholders with the approved existing Secret name and key, do not paste credentials into a manifest):

```yaml
env:
  - name: MONGODB_URI
    valueFrom:
      secretKeyRef:
        name: <approved-existing-secret>
        key: <approved-uri-key>
  - name: SIGNUP_ALLOWED_ORIGIN
    value: <approved-browser-facing-origin>
```

No cluster credentials are supplied or inferred. Before launch, an authorized operator must verify connectivity, least-privilege access, a test subscriber and duplicate retry in `elementa.subscribers`, then remove test data according to the approved retention policy. Local mocked tests do not prove live persistence. Keep preview/noindex and the release gate unchanged until operational and privacy approval.

Run `npm test` for handler validation/acknowledgement/failure/duplicate semantics with an injected repository. Run `PREVIEW_URL=http://127.0.0.1:3120 npm run test:signup` with a dev server on 3120 for mocked API success/failure, timeout and close cancellation in both locales. The existing `test:browser` suite now mocks acknowledged signup rather than expecting no network.

Festival dates and the announcement instant are separate values in `src/content/festival.ts`. Current preview values must receive operational approval before launch. No artists, prices, venue address or available-ticket claims are invented. Event/Offer structured data remains deferred pending the necessary approved facts.

## Assets

The adapted Playa Venao photograph is credited on the localized credits pages under CC BY-SA 3.0. That license does not extend to ELEMENTA brand artwork or application code. Brand assets remain subject to their owners' rights.
