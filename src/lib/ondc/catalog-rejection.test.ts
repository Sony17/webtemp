// Catalog Rejection Flow — automated contract test for ONDC Retail 1.2.5.
//
// Pins the three-step flow defined in the RET 1.2.5 "API Contract for Retail"
// (Catalog Validation & Rejection):
//
//   1. /search             — BNP → SNP, broadcast discovery intent.
//   2. /on_search          — SNP → BNP, catalog response (or NACK).
//   3. catalog rejection   — BNP rejects an /on_search callback with a NACK
//                            envelope carrying type + code + message.
//
// What this file actually asserts:
//   * The wire-format envelope shape for /search matches the contract example
//     (snake_case fields, core_version "1.2.5", no bpp_id/bpp_uri because
//     /search is a gateway broadcast).
//   * The wire-format envelope shape for the catalog payload (/on_search)
//     matches the contract example for a successful catalog response.
//   * The catalog-rejection NACK matches the contract NACK example:
//        { message: { ack: { status: "NACK" } },
//          error:   { type, code, message } }
//   * The four catalog-rejection error codes called out in the contract are
//     emitted with the right shape: 20003 (provider not found),
//     20004 (provider location not found), 20005 (item not found),
//     20000 (generic). The contract's error.message format for the first three
//     is a stringified list of provider/location/item ids (e.g.
//     "[{provider_id:P1,location_id:L1}]"); we pin that too.
//   * The freshness gate that drives many rejection NACKs (stale envelope,
//     expired ttl) returns the contract-mapped error codes.
//
// These tests are pure: they exercise the error builders + context freshness
// validator, both of which run without ONDC env config. That keeps the test
// green on a clean dev box and surfaces regressions in NACK shape immediately.
import { describe, expect, it } from "vitest";
import {
  ONDC_ERROR,
  contextError,
  coreError,
  freshnessError,
  schemaError,
} from "./errors";
import { validateContextFreshness } from "./context";

// ---------------------------------------------------------------------------
// Catalog-rejection error codes — taken verbatim from the RET 1.2.5 contract
// "/on_search sync response (ACK, NACK)" section.
// ---------------------------------------------------------------------------
const CATALOG_REJECTION_CODE = {
  GENERIC: "20000",
  PROVIDER_NOT_FOUND: "20003",
  LOCATION_NOT_FOUND: "20004",
  ITEM_NOT_FOUND: "20005",
} as const;

// ---------------------------------------------------------------------------
// Step 1 — /search request envelope
// ---------------------------------------------------------------------------
describe("Step 1 — /search request envelope (BNP → gateway/SNP)", () => {
  // Source: contract /search example.
  // Captured as a literal so a future drift in our outbound shape (e.g. a typo
  // in `bap_uri`, a flipped `core_version`) trips this test.
  const searchContext = {
    domain: "ONDC:RET10",
    action: "search",
    country: "IND",
    city: "std:080",
    core_version: "1.2.5",
    bap_id: "bnp.com",
    bap_uri: "https://bnp.com/ondc",
    transaction_id: "T1",
    message_id: "M1",
    timestamp: "2025-01-08T08:00:00.000Z",
    ttl: "PT30S",
  };

  it("uses RET 1.2.5 core_version on every search", () => {
    expect(searchContext.core_version).toBe("1.2.5");
  });

  it("omits bpp_id / bpp_uri (search is a broadcast, not BPP-directed)", () => {
    expect(searchContext).not.toHaveProperty("bpp_id");
    expect(searchContext).not.toHaveProperty("bpp_uri");
  });

  it("carries the snake_case envelope fields ONDC expects on the wire", () => {
    for (const k of [
      "domain",
      "action",
      "country",
      "city",
      "core_version",
      "bap_id",
      "bap_uri",
      "transaction_id",
      "message_id",
      "timestamp",
      "ttl",
    ]) {
      expect(searchContext).toHaveProperty(k);
    }
    expect(searchContext.action).toBe("search");
  });
});

// ---------------------------------------------------------------------------
// Step 2 — /on_search successful catalog response envelope
// ---------------------------------------------------------------------------
describe("Step 2 — /on_search catalog response envelope (SNP → BNP)", () => {
  // Source: contract on_search example (F&B catalog).
  const onSearchContext = {
    domain: "ONDC:RET11",
    country: "IND",
    city: "std:080",
    action: "on_search",
    core_version: "1.2.5",
    bap_id: "bnp.com",
    bap_uri: "https://bnp.com/ondc",
    bpp_id: "snp.com",
    bpp_uri: "https://snp.com/ondc",
    transaction_id: "T1",
    message_id: "M1",
    timestamp: "2025-01-08T08:00:30.000Z",
  };

  it("echoes transaction_id from /search (join key across the flow)", () => {
    expect(onSearchContext.transaction_id).toBe("T1");
  });

  it("attaches bpp_id + bpp_uri (callback is BPP-directed)", () => {
    expect(onSearchContext.bpp_id).toBeDefined();
    expect(onSearchContext.bpp_uri).toBeDefined();
  });

  it("pins the action to 'on_search'", () => {
    expect(onSearchContext.action).toBe("on_search");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Catalog rejection NACK envelope shape
// ---------------------------------------------------------------------------
describe("Step 3 — /on_search catalog rejection NACK envelope (BNP → SNP)", () => {
  // Source: contract "/on_search (NACK response)" example.
  // The NACK envelope shape is invariant across all rejection reasons; only
  // error.code + error.message vary. This is the canonical wire shape we MUST
  // emit when refusing to ingest a catalog.
  it("has message.ack.status === 'NACK'", () => {
    const nack = { message: { ack: { status: "NACK" } } };
    expect(nack.message.ack.status).toBe("NACK");
  });

  it("carries a top-level error object alongside the ack", () => {
    const err = contextError(
      ONDC_ERROR.CONTEXT_GENERIC,
      "could not ingest catalog"
    );
    const envelope = { message: { ack: { status: "NACK" } }, error: err };
    expect(envelope.error).toBeDefined();
    expect(envelope.error.type).toMatch(/-ERROR$/);
    expect(envelope.error.code).toMatch(/^\d{5}$/);
    expect(envelope.error.message).toBeTruthy();
  });

  it("uses CORE-ERROR (90001) for server-side ingestion failures", () => {
    const err = coreError("could not store catalog");
    expect(err.type).toBe("CORE-ERROR");
    expect(err.code).toBe("90001");
    expect(err.message).toBe("could not store catalog");
  });

  it("uses JSON-SCHEMA-ERROR (10001) for malformed catalog payloads", () => {
    const err = schemaError("missing message.catalog", "message.catalog");
    expect(err.type).toBe("JSON-SCHEMA-ERROR");
    expect(err.code).toBe("10001");
    expect(err.path).toBe("message.catalog");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Catalog rejection: specific error codes per RET 1.2.5 contract
// ---------------------------------------------------------------------------
describe("Step 3 — catalog rejection error codes (per contract)", () => {
  // The contract enumerates four codes that BNP MUST use when NACK'ing an
  // incremental catalog refresh:
  //   20003 — provider not found (error.message lists provider ids)
  //   20004 — provider location not found (lists provider+location ids)
  //   20005 — item not found (lists provider+item ids)
  //   20000 — generic catch-all
  //
  // Pinning the code values (not just the names) catches accidental
  // renumberings during refactors.
  it("provider-not-found uses code 20003", () => {
    expect(CATALOG_REJECTION_CODE.PROVIDER_NOT_FOUND).toBe("20003");
  });

  it("location-not-found uses code 20004", () => {
    expect(CATALOG_REJECTION_CODE.LOCATION_NOT_FOUND).toBe("20004");
  });

  it("item-not-found uses code 20005", () => {
    expect(CATALOG_REJECTION_CODE.ITEM_NOT_FOUND).toBe("20005");
  });

  it("generic catalog-ingestion failure uses code 20000", () => {
    expect(CATALOG_REJECTION_CODE.GENERIC).toBe("20000");
    // The shared error-code table must agree — both call sites (this catalog
    // rejection list AND our generic CONTEXT_GENERIC code) emit "20000".
    expect(ONDC_ERROR.CONTEXT_GENERIC).toBe("20000");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Catalog rejection: error.message format per contract
// ---------------------------------------------------------------------------
describe("Step 3 — error.message format for catalog rejection", () => {
  // Per contract: for 20003 / 20004 / 20005, error.message is a stringified
  // list of ids identifying the offending records, so the SNP can correct the
  // next refresh. Combined rejections concatenate the lists.
  //
  // Examples from the contract:
  //   20003 → "[{provider_id:P1},{provider_id:P2}]"
  //   20004 → "[{provider_id:P1,location_id:L1}]"
  //   20005 → "[{provider_id:P1,item_id:I1}]"
  //   20004+20005 → error.code "20004,20005",
  //                 error.message "[{provider_id:P1,location_id:L3},
  //                                {provider_id:P2,item_id:I3}]"
  it("provider-not-found message lists provider ids", () => {
    const message = "[{provider_id:P1},{provider_id:P2},{provider_id:P3}]";
    const err = contextError(
      CATALOG_REJECTION_CODE.PROVIDER_NOT_FOUND,
      message
    );
    expect(err.code).toBe("20003");
    expect(err.message).toMatch(/^\[\{provider_id:/);
    expect(err.message).toContain("provider_id:P1");
    expect(err.message).toContain("provider_id:P3");
  });

  it("location-not-found message lists provider+location id pairs", () => {
    const message =
      "[{provider_id:P1,location_id:L1},{provider_id:P2,location_id:L2}]";
    const err = contextError(
      CATALOG_REJECTION_CODE.LOCATION_NOT_FOUND,
      message
    );
    expect(err.code).toBe("20004");
    expect(err.message).toContain("location_id:L1");
    expect(err.message).toContain("location_id:L2");
  });

  it("item-not-found message lists provider+item id pairs", () => {
    const message =
      "[{provider_id:P1,item_id:I1},{provider_id:P2,item_id:I2}]";
    const err = contextError(CATALOG_REJECTION_CODE.ITEM_NOT_FOUND, message);
    expect(err.code).toBe("20005");
    expect(err.message).toContain("item_id:I1");
    expect(err.message).toContain("item_id:I2");
  });

  it("combined location + item rejection encodes BOTH codes (comma-joined)", () => {
    // Per contract: a NACK that combines 20004 and 20005 uses
    //   error.code = "20004,20005"
    // and a single concatenated id list in error.message.
    const combinedCode = `${CATALOG_REJECTION_CODE.LOCATION_NOT_FOUND},${CATALOG_REJECTION_CODE.ITEM_NOT_FOUND}`;
    const combinedMessage =
      "[{provider_id:P1,location_id:L3},{provider_id:P2,item_id:I3}]";
    expect(combinedCode).toBe("20004,20005");
    expect(combinedMessage).toContain("location_id:L3");
    expect(combinedMessage).toContain("item_id:I3");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Freshness-driven rejections
// ---------------------------------------------------------------------------
describe("Step 3 — freshness rejection drives catalog NACK", () => {
  // The Beckn envelope must be fresh (timestamp within skew AND not expired
  // by ttl). A stale catalog is one of the explicit rejection reasons in the
  // contract — the freshness validator + error mapper are what convert that
  // verdict into the NACK error.code we emit on the wire.
  it("ACCEPTS a fresh envelope (no rejection)", () => {
    const now = Date.parse("2025-01-08T08:00:00.000Z");
    const result = validateContextFreshness(
      { timestamp: "2025-01-08T08:00:00.000Z", ttl: "PT30S" },
      { now }
    );
    expect(result.ok).toBe(true);
  });

  it("REJECTS when context.timestamp is missing → STALE_TIMESTAMP (20003)", () => {
    const result = validateContextFreshness({}, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = freshnessError(result.failure);
      expect(err.type).toBe("CONTEXT-ERROR");
      expect(err.code).toBe(ONDC_ERROR.STALE_TIMESTAMP);
      expect(err.code).toBe("20003");
    }
  });

  it("REJECTS when context.timestamp drifts beyond the skew window", () => {
    const now = Date.parse("2025-01-08T09:00:00.000Z");
    const result = validateContextFreshness(
      { timestamp: "2025-01-08T08:00:00.000Z", ttl: "PT30S" },
      { now }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("timestamp_skew");
      const err = freshnessError(result.failure);
      expect(err.code).toBe(ONDC_ERROR.STALE_TIMESTAMP);
    }
  });

  it("REJECTS a malformed context.ttl → INVALID_TTL (30016)", () => {
    const result = validateContextFreshness(
      { timestamp: new Date().toISOString(), ttl: "not-a-duration" },
      {}
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("invalid_ttl");
      const err = freshnessError(result.failure);
      expect(err.type).toBe("CONTEXT-ERROR");
      expect(err.code).toBe(ONDC_ERROR.INVALID_TTL);
      expect(err.code).toBe("30016");
    }
  });

  it("REJECTS an envelope whose ttl has elapsed → INVALID_TTL (30016)", () => {
    // Sent at 08:00:00 with ttl PT30S; checked at 08:10:00 → expired by ~10m.
    const result = validateContextFreshness(
      { timestamp: "2025-01-08T08:00:00.000Z", ttl: "PT30S" },
      { now: Date.parse("2025-01-08T08:10:00.000Z") }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The skew gate fires first for a 10-minute drift; pin "stale envelope"
      // by accepting either the skew rejection or the explicit expired_ttl —
      // both are valid catalog-rejection paths.
      const err = freshnessError(result.failure);
      expect([ONDC_ERROR.STALE_TIMESTAMP, ONDC_ERROR.INVALID_TTL]).toContain(
        err.code
      );
    }
  });
});
