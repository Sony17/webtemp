# Production PostgreSQL Deployment

This document explains how to activate the **PostgreSQL** persistence backend in
production for the ONDC Buyer App, and how to verify it is active instead of the
per-instance JSON fallback.

> **TL;DR** — The repository is already fully Postgres-capable. Production only
> needs (1) a Postgres database, (2) the `init` migration applied to it, and
> (3) `DATABASE_URL` (+ `DIRECT_URL`) set in Vercel. **No runtime code changes
> are required.**

---

## Why this is needed

`src/lib/ondc/store.ts` selects the backend **once per process at module load**:

```ts
const backend = isDatabaseConfigured() ? dbBackend : jsonBackend;
```

`isDatabaseConfigured()` (`src/lib/db.ts`) is simply `!!process.env.DATABASE_URL`.

- **`DATABASE_URL` set** → `store-db.ts` (Postgres via Prisma + `@prisma/adapter-pg`).
  All serverless instances read/write the **same** database, so `on_search`
  catalog slices and order state are consistent across instances.
- **`DATABASE_URL` unset** → `store-json.ts` (in-memory `Map`s on `globalThis`
  with a `/tmp` or Blob snapshot). On Vercel's multi-instance serverless runtime
  this **fragments** a transaction's state: each instance holds only the
  callbacks it personally received, so `/api/shop/state` alternates between
  populated and empty for the same `transactionId`.

The fix is therefore an **environment + one-time migration** task, not a code change.

---

## 1. `DATABASE_URL`

The **runtime** connection string used by the app (`src/lib/db.ts`). For a
serverless deployment (Vercel) use a **pooled** connection so connection bursts
don't exhaust Postgres.

- Supabase pooled (recommended for runtime): port **6543**, host
  `aws-<n>-<region>.pooler.supabase.com`, and append `?pgbouncer=true`.
  ```
  DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
  ```
- Neon / Vercel Postgres: use their pooled connection string.

## 2. `DIRECT_URL`

The **migration-time** connection string used by the Prisma CLI
(`prisma.config.ts` prefers `DIRECT_URL`, falling back to `DATABASE_URL`).
pgbouncer (the pooled endpoint) cannot run migration DDL, so migrations must use
a **direct** connection.

- Supabase direct: port **5432**, host `db.<ref>.supabase.co`.
  ```
  DIRECT_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
  ```
- If your provider accepts DDL on the same URL as runtime (no pgbouncer), you may
  set `DATABASE_URL` only and skip `DIRECT_URL`.

## 3. Supabase setup

1. Create a project at <https://supabase.com>.
2. **Project Settings → Database → Connection string**:
   - Copy the **Transaction pooler** string → use for `DATABASE_URL` (port 6543).
   - Copy the **Direct connection** string → use for `DIRECT_URL` (port 5432).
3. URL-encode any special characters in the password.
4. No tables need to be created by hand — the `init` migration (Section 5) creates
   all four ONDC tables.

## 4. Vercel environment variables

In the Vercel project **`webtemp-bjcd`** → **Settings → Environment Variables**,
add to the **Production** environment (and Preview if you want previews on
Postgres too):

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | **Yes** | pooled Postgres URL (port 6543) |
| `DIRECT_URL` | Recommended | direct Postgres URL (port 5432) — needed if migrations are run from/through Vercel |
| `BLOB_READ_WRITE_TOKEN` | Optional | only relevant to the JSON fallback; not used by Postgres |

After adding variables you **must redeploy** — the backend is bound at process
start, so a running instance won't pick up `DATABASE_URL` until it restarts.

## 5. `prisma migrate deploy` (recommended for production)

Applies committed migrations (`prisma/migrations/`) to the target database
**without** generating new ones. Run it **once** against the production DB after
provisioning, and again whenever new migrations are added.

```bash
# From a machine/CI with the DIRECT (un-pooled) URL available:
DATABASE_URL="<direct-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

This creates: `ondc_search`, `ondc_search_result`, `ondc_order`, `ondc_event`,
the `OrderStage` enum, all indexes, and the foreign keys — exactly matching
`prisma/schema.prisma`.

## 6. `prisma db push` (alternative — no migration history)

Applies `schema.prisma` directly without using/recording migration files. Simpler,
but does not track migration history. Prefer `migrate deploy` (Section 5) for
production; use `db push` only for throwaway/dev databases.

```bash
DATABASE_URL="<direct-url>" npx prisma db push
```

> Do **not** mix the two on the same database. This repo ships a committed
> `init` migration, so `migrate deploy` is the intended path.

## 7. Production verification

After setting env vars + applying the migration + redeploying:

1. Fire a real discovery search:
   ```bash
   curl -sS -X POST https://openidea.co.in/api/ondc/search \
     -H 'Content-Type: application/json' \
     -d '{"query":"rice","deliveryGps":"12.9716,77.5946","deliveryAreaCode":"560001"}'
   # → {"status":"ACK","transactionId":"<txn>", ...}
   ```
2. Poll the state endpoint **several times** for that `<txn>`:
   ```bash
   for i in $(seq 1 8); do
     curl -sS "https://openidea.co.in/api/shop/state?transactionId=<txn>" \
       | python -c "import sys,json;print('catalogs',len(json.load(sys.stdin)['catalogs']))"
     sleep 2
   done
   ```
   - **Postgres active:** the catalog count is **stable** across every poll and
     **aggregates all responding sellers** (no `1 ↔ 0` flipping).
   - **JSON fallback (bug):** the count **alternates** between populated and empty
     depending on which serverless instance answers.
3. Confirm the rows exist in the DB:
   ```sql
   SELECT count(*) FROM ondc_search_result WHERE "transactionId" = '<txn>';
   ```

## 8. Rollback procedure

The backend switch is just an env var, so rollback is non-destructive:

1. **Revert to JSON fallback:** remove (or blank) `DATABASE_URL` in Vercel and
   redeploy. The dispatcher falls back to `store-json.ts` at next process start.
   (You lose cross-instance consistency again — this is only a safety valve.)
2. **Bad migration:** since the `init` migration only `CREATE`s objects, rolling
   back means dropping them on a fresh/empty DB:
   ```sql
   DROP TABLE IF EXISTS "ondc_event","ondc_order","ondc_search_result","ondc_search" CASCADE;
   DROP TYPE IF EXISTS "OrderStage";
   ```
   Then re-run `prisma migrate deploy`. **Only do this on a database with no
   production data you need to keep.**
3. No code rollback is needed — runtime code is unchanged by this work.

## 9. Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Callbacks NACK 500 `relation "ondc_search" does not exist` | `DATABASE_URL` set but migration not applied | Run `prisma migrate deploy` (Section 5) |
| `prisma migrate deploy` hangs / `prepared statement` errors | Running migrations through the **pooled** (pgbouncer) URL | Use the **direct** URL for migrations (`DIRECT_URL`, port 5432) |
| Runtime `too many connections` / connection exhaustion under load | Using the **direct** URL for runtime on serverless | Use the **pooled** URL for `DATABASE_URL` (port 6543) |
| `/api/shop/state` still alternates `1 ↔ 0` after deploy | App still on JSON fallback — `DATABASE_URL` not present at process start, or not redeployed | Verify the var is in the **Production** scope and redeploy |
| Auth/`password authentication failed` | Special characters in password not URL-encoded | URL-encode the password |
| Build fails on Prisma | (Should not happen) `prisma generate` runs in build and tolerates a missing URL via `prisma.config.ts` | Ensure deps installed; `prisma generate` |

## 10. How to verify Postgres is active (not JSON fallback)

Definitive signals, in order of strength:

1. **Cross-instance consistency:** repeated `/api/shop/state` reads of the same
   `transactionId` return the **same, complete** catalog set (Section 7). The
   JSON fallback's signature is the `catalogs: 1 ↔ 0` flip.
2. **Rows in Postgres:** `SELECT count(*) FROM ondc_search_result;` grows as
   `on_search` callbacks arrive.
3. **Vercel runtime logs:** with Postgres active and the migration applied,
   `on_search` logs show `ondc.on_search persisted` with **HTTP 200** and no
   `OndcStoreError: failed to ...` / `relation ... does not exist`. (If
   `DATABASE_URL` were set but the schema missing, you'd instead see persist
   failures / 500s.)
4. **All responding sellers visible:** a single search shows catalogs from
   multiple BPPs at once (e.g. `api.kaarobari.com`, `ondc.preprod.yuukke.com`,
   `seller.glydiotech.in`), which only happens when every instance writes to one
   shared store.

---

### Notes on build behaviour (intentional)

- `package.json` `build` is `prisma generate && next build`, and `postinstall`
  also runs `prisma generate`. This is correct and sufficient: the Prisma client
  is generated at build/install time and tolerates a missing `DATABASE_URL`.
- **`prisma migrate deploy` is deliberately NOT in the build command.** Migrations
  are applied once, deliberately (Section 5) — not on every build — because:
  (a) every Vercel build would otherwise need a reachable DB + `DIRECT_URL`,
  adding a new failure mode to all builds; (b) concurrent/preview builds could
  race to migrate the same database; (c) a faulty migration would break *every*
  deploy instead of one controlled release step. Decoupling deploy from migrate
  is the Prisma-recommended practice for serverless.
