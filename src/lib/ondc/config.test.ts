// Pins readOndcScopedEnv — the mechanism behind the ONDC_ENV network switch.
// Both credential sets (ONDC_PREPROD_* / ONDC_PROD_*) live in the environment
// at once; these tests prove the right one wins and the fallbacks stay sane.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readOndcScopedEnv } from "./config";

const TOUCHED = [
  "ONDC_ENV",
  "ONDC_NO_TOKEN",
  "ONDC_PREPROD_NO_TOKEN",
  "ONDC_PROD_NO_TOKEN",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readOndcScopedEnv", () => {
  it("prefers the ONDC_ENV-scoped name over the plain name", () => {
    process.env.ONDC_ENV = "prod";
    process.env.ONDC_NO_TOKEN = "plain";
    process.env.ONDC_PROD_NO_TOKEN = "prod-token";
    process.env.ONDC_PREPROD_NO_TOKEN = "preprod-token";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("prod-token");
  });

  it("switches which scoped set is live when ONDC_ENV flips", () => {
    process.env.ONDC_PROD_NO_TOKEN = "prod-token";
    process.env.ONDC_PREPROD_NO_TOKEN = "preprod-token";
    process.env.ONDC_ENV = "preprod";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("preprod-token");
    process.env.ONDC_ENV = "prod";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("prod-token");
  });

  it("falls back to the plain name when no scoped variant is set", () => {
    process.env.ONDC_ENV = "prod";
    process.env.ONDC_NO_TOKEN = "plain";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("plain");
  });

  it("returns undefined when neither scoped nor plain is set", () => {
    process.env.ONDC_ENV = "prod";
    process.env.ONDC_PREPROD_NO_TOKEN = "preprod-token"; // other env's set
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBeUndefined();
  });

  it("treats a blank scoped value as unset (falls through to plain)", () => {
    process.env.ONDC_ENV = "prod";
    process.env.ONDC_PROD_NO_TOKEN = "   ";
    process.env.ONDC_NO_TOKEN = "plain";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("plain");
  });

  it("never throws on an invalid ONDC_ENV — scoping just turns off", () => {
    process.env.ONDC_ENV = "production"; // not a valid enum value
    process.env.ONDC_NO_TOKEN = "plain";
    process.env.ONDC_PROD_NO_TOKEN = "prod-token";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("plain");
  });

  it("defaults to staging scoping when ONDC_ENV is unset", () => {
    process.env.ONDC_NO_TOKEN = "plain";
    expect(readOndcScopedEnv("ONDC_NO_TOKEN")).toBe("plain");
  });
});
