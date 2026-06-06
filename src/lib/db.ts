// Prisma client singleton.
//
// Prisma 7 dropped the in-schema `url` setting in favor of a runtime driver
// adapter. We construct one PrismaClient per Node process, holding it on a
// globalThis slot so Next dev's hot-module reload doesn't open a new pool on
// every reload (a classic Next + Prisma footgun that exhausts Postgres
// connections within a handful of edits).
//
// Server-only on purpose: the Prisma client talks SQL — never let it leak into
// a client bundle.
import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

// True only when a DATABASE_URL is configured. Used by the store dispatcher to
// decide whether to route writes/reads to Postgres or to the JSON store. Kept
// as a function (not a constant) so a test or worker can set the env after
// module load and have the next call observe it.
export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

// Build the client lazily so `next build` (which evaluates this module while
// tree-shaking) does NOT throw when DATABASE_URL is unset. The thrown error
// would mask the real, intended fallback path (JSON store).
function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The Prisma-backed ONDC store requires a " +
        "Postgres connection string (postgres://…); without it, the JSON " +
        "store remains the active backend."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Returns the process-wide PrismaClient, constructing it on first call. Throws
// if DATABASE_URL is missing — callers gate on isDatabaseConfigured() first.
export function getPrisma(): PrismaClient {
  if (!globalThis.__prisma__) {
    globalThis.__prisma__ = buildClient();
  }
  return globalThis.__prisma__;
}
