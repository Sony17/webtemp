// Catalog validator — walks an /on_search payload and returns the
// (provider, location, item) ids the BAP refuses to ingest, plus the contract
// error code that names the rejection reason.
//
// RET 1.2.5 codes pinned by src/lib/ondc/catalog-rejection.test.ts:
//   20003 — provider not found
//   20004 — provider location not found
//   20005 — item not found / invalid
//   20000 — generic ingestion failure
//
// We deliberately do the minimum the Workbench rejection test needs:
//   * detect items with price.value > price.maximum_value (MRP violation)
//   * detect items missing a provider/id (defensive)
// More rules can be layered on without touching the outbound poster — it
// consumes a flat list of rejected ids.
//
// Stateless and pure: no I/O, no clock, no env reads. Easy to unit test.
import type { OndcError } from "@/lib/ondc/client";

// A single rejected record. `kind` lets the outbound poster format the
// contract message ("[{provider_id:P1,item_id:I1}]" etc.) without re-walking
// the catalog.
export type CatalogRejection =
  | { kind: "item"; provider_id: string; item_id: string; reason: string }
  | { kind: "location"; provider_id: string; location_id: string; reason: string }
  | { kind: "provider"; provider_id: string; reason: string };

export type CatalogValidationResult = {
  ok: boolean;
  rejections: CatalogRejection[];
  // The error block to mirror back in the catalog_rejection callback.
  // Null when ok === true (no issues found).
  error: OndcError | null;
};

// ---------------------------------------------------------------------------
// Type-tolerant catalog walk
// ---------------------------------------------------------------------------
// ONDC catalog shapes are large and weakly typed at the BAP side; we only read
// the fields we validate, and treat anything else as opaque. `unknown` in →
// boolean checks → typed-narrow into the small subset we care about.

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateCatalog(catalog: unknown): CatalogValidationResult {
  const rejections: CatalogRejection[] = [];

  if (!isObj(catalog)) {
    return {
      ok: false,
      rejections: [],
      error: {
        type: "DOMAIN-ERROR",
        code: "20000",
        message: "catalog payload is not an object",
      },
    };
  }

  const providers = catalog["bpp/providers"];
  if (!Array.isArray(providers) || providers.length === 0) {
    return {
      ok: false,
      rejections: [],
      error: {
        type: "DOMAIN-ERROR",
        code: "20003",
        message: "no providers in catalog",
      },
    };
  }

  for (const p of providers) {
    if (!isObj(p)) continue;
    const providerId = asString(p.id);
    if (!providerId) {
      // Can't address it for rejection without an id; report a generic gap.
      rejections.push({
        kind: "provider",
        provider_id: "",
        reason: "missing provider.id",
      });
      continue;
    }

    // Item-level validation — the workbench test scenario plants invalid items
    // (price.value > maximum_value). Walk every item and flag violations.
    const items = p.items;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (!isObj(it)) continue;
        const itemId = asString(it.id);
        if (!itemId) {
          rejections.push({
            kind: "item",
            provider_id: providerId,
            item_id: "",
            reason: "missing item.id",
          });
          continue;
        }

        const price = isObj(it.price) ? it.price : null;
        if (price) {
          const value = asNumber(price.value);
          const maxValue = asNumber(price.maximum_value);
          // Selling price above MRP — a hard contract violation we MUST refuse.
          if (
            typeof value === "number" &&
            typeof maxValue === "number" &&
            value > maxValue
          ) {
            rejections.push({
              kind: "item",
              provider_id: providerId,
              item_id: itemId,
              reason: `price.value (${value}) > maximum_value (${maxValue})`,
            });
          }
        }
      }
    }
  }

  if (rejections.length === 0) {
    return { ok: true, rejections: [], error: null };
  }

  // Build the contract error block. When the rejections are all the same kind,
  // we use that kind's specific code (20003/20004/20005); when mixed we
  // comma-join them per the contract's combined-code rule.
  const codeSet = new Set<string>();
  for (const r of rejections) {
    codeSet.add(
      r.kind === "provider"
        ? "20003"
        : r.kind === "location"
          ? "20004"
          : "20005"
    );
  }
  const code = Array.from(codeSet).sort().join(",");

  return {
    ok: false,
    rejections,
    error: {
      type: "DOMAIN-ERROR",
      code,
      message: formatRejectionMessage(rejections),
    },
  };
}

// Format per the RET 1.2.5 contract NACK examples:
//   20003 → "[{provider_id:P1},{provider_id:P2}]"
//   20004 → "[{provider_id:P1,location_id:L1}]"
//   20005 → "[{provider_id:P1,item_id:I1}]"
// Combined → "[{provider_id:P1,location_id:L3},{provider_id:P2,item_id:I3}]"
export function formatRejectionMessage(
  rejections: readonly CatalogRejection[]
): string {
  const parts = rejections.map((r) => {
    if (r.kind === "provider") {
      return `{provider_id:${r.provider_id}}`;
    }
    if (r.kind === "location") {
      return `{provider_id:${r.provider_id},location_id:${r.location_id}}`;
    }
    return `{provider_id:${r.provider_id},item_id:${r.item_id}}`;
  });
  return `[${parts.join(",")}]`;
}
