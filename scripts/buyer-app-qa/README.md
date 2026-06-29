# Buyer-app QA tooling

Migrated from the prototype branch (`feature/ondc-buyer-app-ui`) and adapted to
the current in-repo buyer app under `/shop`.

## console-check.mjs
Visits every `/shop` route and reports console errors/warnings + uncaught page
errors. Useful as a quick smoke test.

```bash
npm i -D playwright && npx playwright install chromium
npm run dev                              # serves on :3000
node scripts/buyer-app-qa/console-check.mjs
```

Set `BASE` to target another origin (e.g. a preview deploy).

## Note on the prototype's screenshot script
The prototype's `shots.mjs` captured per-page screenshots across viewports. It is
**not** ported as runnable here because it deep-links to product pages by id, and
in the current app product pages are keyed by `(bppId, providerId, itemId)` from
a **live ONDC discovery transaction** — there is no static product URL to shoot
without first running a real `search → on_search` against a responsive seller.
Re-create it against a seeded transaction if visual regression shots are needed.
