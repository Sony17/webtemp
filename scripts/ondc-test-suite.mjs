#!/usr/bin/env node
// ONDC end-to-end test suite — runs against a live Next.js server.
//
// Usage:
//   node scripts/ondc-test-suite.mjs                    # all scenarios
//   node scripts/ondc-test-suite.mjs --only=on_search   # filter by route
//   node scripts/ondc-test-suite.mjs --category=auth    # filter by axis
//   node scripts/ondc-test-suite.mjs --base-url=https://stage.example
//   node scripts/ondc-test-suite.mjs --format=json      # machine-readable
//   node scripts/ondc-test-suite.mjs --tap              # TAP 14 output
//
// The runner uses the local server's actual response (no mocking). It does NOT
// assume ONDC is configured — every scenario allows the "503 unconfigured" path
// so the suite passes against a clean dev box AND surfaces real failures once
// ONDC env vars are present.
//
// References (used to seed scenarios):
//   - ONDC Beckn Protocol Specifications: github.com/ONDC-Official/ONDC-Protocol-Specs
//   - Buyer App reference: github.com/ONDC-Official/reference-implementations
//   - This repo's ONDC contracts: src/app/api/ondc/*/route.ts + src/lib/ondc/*
import { DEFAULT_BASE_URL, evaluate, httpRequest } from "./ondc/harness.mjs";
import { buildOutboundScenarios } from "./ondc/scenarios/outbound.mjs";
import { buildCallbackScenarios } from "./ondc/scenarios/callbacks.mjs";
import { buildRegistryScenarios } from "./ondc/scenarios/registry.mjs";

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? DEFAULT_BASE_URL;
const onlyRoute = args.only;
const onlyCategory = args.category;
const format = args.tap ? "tap" : args.format ?? "human";

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === "--tap") {
      out.tap = true;
      continue;
    }
    const m = /^--([\w-]+)=?(.*)$/.exec(a);
    if (m) out[m[1]] = m[2] || true;
  }
  return out;
}

async function preflight() {
  const res = await httpRequest({
    baseUrl,
    method: "GET",
    path: "/api/ondc/registry-status",
    timeoutMs: 5_000,
  });
  if (res.status === 0) {
    process.stderr.write(
      `error: cannot reach ${baseUrl} — start the dev server first ` +
        `(npm run dev) or pass --base-url=…\n`
    );
    process.exit(2);
  }
  return res;
}

async function main() {
  const startedAt = Date.now();
  const preflightRes = await preflight();

  const ondcConfigured = preflightRes.status !== 503;
  const all = [
    ...buildRegistryScenarios(),
    ...buildOutboundScenarios(),
    ...buildCallbackScenarios(),
  ];

  const filtered = all.filter((s) => {
    if (onlyRoute && !s.route.includes(onlyRoute)) return false;
    if (onlyCategory && s.category !== onlyCategory) return false;
    return true;
  });

  if (format === "human") {
    process.stdout.write(
      `ONDC test suite — ${filtered.length} scenarios → ${baseUrl}\n` +
        `Preflight: registry-status ${preflightRes.status} ` +
        `(${ondcConfigured ? "ONDC configured" : "ONDC NOT configured"})\n\n`
    );
  } else if (format === "tap") {
    process.stdout.write(`TAP version 14\n1..${filtered.length}\n`);
  }

  const results = [];
  let idx = 0;
  for (const s of filtered) {
    idx++;
    let res;
    try {
      res = await s.run({ baseUrl });
    } catch (err) {
      res = {
        ok: false,
        status: 0,
        text: "",
        json: null,
        error: err instanceof Error ? err.message : String(err),
        ms: 0,
      };
    }
    const evaluated = evaluate({
      name: s.name,
      route: s.route,
      category: s.category,
      ref: s.ref,
      res,
      expect: s.expect,
    });
    results.push(evaluated);

    if (format === "human") {
      const tag = evaluated.pass ? "PASS" : "FAIL";
      const tail = evaluated.pass
        ? `${evaluated.status} (${evaluated.ms}ms)`
        : `${evaluated.status} — ${evaluated.errors.join("; ")}`;
      process.stdout.write(
        `  [${tag}] ${s.category.padEnd(20)} ${s.route.padEnd(28)} ${s.name}\n` +
          `         ${tail}\n`
      );
    } else if (format === "tap") {
      const tap = evaluated.pass ? "ok" : "not ok";
      process.stdout.write(
        `${tap} ${idx} - ${s.name} # ${s.category} ${s.route}\n`
      );
      if (!evaluated.pass) {
        process.stdout.write(
          `  ---\n  status: ${evaluated.status}\n  errors:\n` +
            evaluated.errors.map((e) => `    - "${e}"`).join("\n") +
            `\n  ...\n`
        );
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const byCategory = results.reduce((m, r) => {
    m[r.category] ??= { pass: 0, fail: 0 };
    m[r.category][r.pass ? "pass" : "fail"]++;
    return m;
  }, {});

  if (format === "human") {
    process.stdout.write(
      `\nSummary: ${passed} passed, ${failed} failed, ${results.length} total ` +
        `(${Date.now() - startedAt}ms)\n`
    );
    for (const [cat, c] of Object.entries(byCategory)) {
      process.stdout.write(
        `  ${cat.padEnd(22)} ${c.pass} pass / ${c.fail} fail\n`
      );
    }
    if (!ondcConfigured) {
      process.stdout.write(
        `\nNote: ONDC is not configured on this server. Validation/auth-gate\n` +
          `      branches are still exercised — to also exercise the gateway\n` +
          `      dial paths, set ONDC_SUBSCRIBER_ID + signing keys (see\n` +
          `      src/lib/ondc/config.ts) and rerun.\n`
      );
    }
  } else if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          baseUrl,
          ondcConfigured,
          total: results.length,
          passed,
          failed,
          byCategory,
          results,
        },
        null,
        2
      ) + "\n"
    );
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `fatal: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(2);
});
