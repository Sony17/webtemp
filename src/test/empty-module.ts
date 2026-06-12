// Stub for the `server-only` package under vitest. The real `server-only`
// throws on import outside a React Server Component bundle, which breaks unit
// tests of server-only modules (config/auth/idempotency/store/registry). The
// vitest config aliases `server-only` → this empty module so those modules can
// be imported and unit-tested in a plain Node test environment.
export {};
