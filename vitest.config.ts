import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal vitest setup for unit tests of the ONDC server-only modules.
//
// Two aliases are required:
//   - `server-only` → an empty stub. The real package throws on import outside
//     an RSC bundle; without this, importing idempotency.ts / config.ts / etc.
//     fails at module load in a Node test env.
//   - `@` → src, matching the tsconfig path mapping the routes/libs use.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "src/test/empty-module.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // Only ONDC unit tests for now. The orphaned payment.test.ts imports a
    // non-existent ./payment module (pre-existing); exclude it until that
    // module lands so the suite is green.
    include: ["src/lib/ondc/**/*.test.ts"],
    exclude: ["src/lib/ondc/payment.test.ts", "node_modules/**"],
  },
});
