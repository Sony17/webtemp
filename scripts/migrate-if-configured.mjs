// Build-time guard: apply Prisma migrations ONLY when a database is configured.
//
// Production can run on either backend (see src/lib/ondc/store.ts):
//   * Postgres    — when DATABASE_URL is set (the store-db backend).
//   * JSON /tmp   — when it is not (the store-json backend).
//
// `prisma migrate deploy` needs a reachable database; running it unconditionally
// would fail every JSON-store build (and every CI build without a DB). So we
// gate on DATABASE_URL: when set, apply migrations so the ondc_* tables exist
// before the app boots; when unset, skip cleanly and let the JSON store run.
//
// prisma.config.ts resolves the migrate connection from DIRECT_URL || DATABASE_URL,
// so a pooled DATABASE_URL + direct DIRECT_URL split works as recommended.
import { execSync } from "node:child_process";

const configured = !!process.env.DATABASE_URL?.trim();

if (!configured) {
  console.log(
    "[build] DATABASE_URL not set — skipping Prisma migrate (JSON store backend)."
  );
  process.exit(0);
}

console.log(
  "[build] DATABASE_URL detected — applying Prisma migrations (prisma migrate deploy)…"
);
execSync("npx prisma migrate deploy", { stdio: "inherit" });
