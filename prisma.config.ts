// Prisma 7 CLI config.
//
// Prisma 7 removed the in-schema `datasource.url`; the CLI now reads it from
// this file. The runtime client (src/lib/db.ts) builds its own driver adapter
// from process.env.DATABASE_URL — independent of this file.
//
// Supabase exposes two connection strings:
//   * Direct (port 5432, host `db.<ref>.supabase.co`) — REQUIRED for the
//     migrate CLI; pgbouncer doesn't proxy migration-time commands.
//   * Pooled (port 6543, host `aws-<n>-<region>.pooler.supabase.com`) — best
//     for serverless RUNTIME (Vercel) because it survives connection bursts.
//
// We prefer DIRECT_URL if set, falling back to DATABASE_URL. Recommended split
// for production: DATABASE_URL = pooled, DIRECT_URL = direct. For local-only
// usage, setting just DATABASE_URL to the direct string is fine.
import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Empty string is fine here: the CLI fails with a clear message when a
    // command actually needs a URL, while `prisma generate` (which doesn't
    // need one) keeps working in environments without a DB configured.
    url: url ?? "",
  },
});
