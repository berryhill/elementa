# Google Analytics

The site loads the owner-requested Google tag `G-D6NRX54EQP` once from the root layout using `next/script`, `afterInteractive`, and an async `https://www.googletagmanager.com/gtag/js?id=G-D6NRX54EQP` script. The standard `dataLayer`, `gtag('js', new Date())`, and `gtag('config', ...)` initialization is queued before the library loads.

## Collection contract

- The application sends one explicit `page_view` per recognized pathname visit. `send_page_view: false` disables the config command's automatic initial view. Rerenders, query-only changes and fragment changes do not add views; returning to a page after another pathname does.
- Only `/es`, `/en`, and their `/credits` pages initialize collection. Locale and page type reuse `analyticsPageContext`; arbitrary paths are not sent.
- Page locations are reconstructed from the current origin and allowlisted page identity, never the raw URL. Queries and fragments are discarded. Referrer is deliberately blank and titles are fixed allowlisted strings. This sacrifices campaign/referral attribution for data minimization.
- No email, consent checkbox, form payload, subscriber identifier or signup event is passed to analytics. Signup database behavior is unchanged. Google Signals and ad-personalization signals are disabled in config.
- The tag does not change preview `noindex`, release gates, metadata, hosting or deployment. An authorized tag installation is not authorization for an indexable launch.

## Property-owner verification (outside this code change)

In this GA4 web stream, disable Enhanced Measurement, particularly history-based page views, form interactions and site search. Manual page views are owned by the application; property-side automatic collection can duplicate them or collect additional URL/form context. `send_page_view: false` alone is not a guarantee that a property with history measurement enabled will avoid duplicates. Do not enable user-provided data collection or additional tags without a fresh privacy review.

The property settings, applicable analytics consent/privacy notice and retention policy still require owner review. This installation does not add a consent-management platform, establish legal compliance, change Google account settings, or prove live traffic receipt. Production privacy and duplicate-event behavior must be checked against the actual property configuration before public launch.

## Verification without real Google traffic

```
npm test
npm run typecheck
npm run build
npm run start -- --hostname 127.0.0.1 --port 3117
# In another terminal (or omit executable path when Playwright browsers are installed):
BASE_URL=http://127.0.0.1:3117 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome node tests/analytics.e2e.mjs
```

The browser test replaces the Google script with an inert mock and blocks all other off-origin requests. It verifies the real built integration, queued commands, both locales/credits, client pathname transitions and revisits, query/fragment deduplication, signup-input isolation, noindex, 404 exclusion, and absence of uncaught page errors. It does not execute the vendor library, inspect GA account settings, or assert Google received events. Do not run ordinary unmocked browser tests against this tag if test traffic must not reach Google.
