# ONDC versioning — technical note & pre-production TODO

**Status:** Planned, not implemented. **Gate:** must be done **before production rollout**.
**Owner:** _unassigned_ · **Last verified:** 2026-06-04

## TL;DR

`context.ts` currently hardcodes a single protocol version (`ONDC_CORE_VERSION = "1.2.5"`)
and emits the **flat** `country` / `city` context shape. This is correct for the
**1.2.x B2C domestic Retail** family only. Before production we will refactor version
handling into a **VersionProfile strategy** so multiple ONDC versions can be switched
from config without duplicating builder logic.

**Do not implement the switch yet** — the active Retail protocol version is confirmed as
**1.2.5** (flat shape), so the single pinned constant is correct for now. The strategy
refactor remains gated on multi-version/2.0.x support (see "Open question" below).

## Why this is needed

Two structurally different ONDC Retail context schemas are in active use. Verified
from live official spec payloads (ONDC-RET-Specifications `release-2.0.2` and the
1.2.x reference):

| Aspect              | 1.2.0 / 1.2.x family            | 2.0.x family (B2B / B2C-Exports)              |
| ------------------- | ------------------------------- | --------------------------------------------- |
| Version field name  | `core_version`                  | `version`                                     |
| Version value       | `1.2.0`, `1.2.5`                | `2.0.2`                                        |
| Location shape      | flat `country`, `city` strings  | nested `location.country.code` / `.city.code` |

So a "version switch" must handle **two kinds of variance**:
1. trivial value swap within the 1.2.x family (`1.2.0` → `1.2.5`), and
2. a structural shape swap across the 1.x ↔ 2.x boundary (field rename + nesting).

A switch that only toggles the version string would break the moment a 2.0.x version
is selected.

## What varies vs. what is invariant

The refactor is worthwhile because **~90% of `buildContext` is version-agnostic**:

- **Invariant (write once, never branch):** `transaction_id` / `message_id` generation,
  `timestamp`, `ttl`, `bap_id`, `bap_uri`, `domain`, `action`, and the BPP-routing rule
  (`search` broadcasts; all other actions are directed at a BPP).
- **Variant (the only thing a version controls):** the version field's **name** and
  **value**, and the **location representation** (flat vs. nested). Possibly extra or
  renamed fields in future versions.

Duplication arises only when the whole builder is copied per version. The fix isolates
*only the variant slice* behind a seam.

## Planned design — VersionProfile registry (Strategy pattern)

A small declarative `VersionProfile` object per version, held in a registry keyed by
version id. `buildContext` computes the invariant fields once, then delegates the
variant rendering to the selected profile.

**`VersionProfile` (per version):**
- `id` — e.g. `"1.2.0"`, `"1.2.5"`, `"2.0.2"`
- `versionField` — `"core_version"` | `"version"`
- `versionValue` — the string emitted on the wire
- `renderLocation(country, city)` — returns the partial to merge: either
  `{ country, city }` or `{ location: { country: { code }, city: { code } } }`
- `family` — `"1.x"` | `"2.x"`, a discriminator that future message/intent-body
  builders (which also fork at 1.x ↔ 2.x) can consult via the same registry

**Registry:** `Record<OndcVersionId, VersionProfile>`. Adding a version = **one entry**,
**zero edits** to the builder or to any call site (Open/Closed).

**Builder flow:** resolve profile (per-call `version` param → config default) → build
invariant fields → spread `{ [profile.versionField]: profile.versionValue,
...profile.renderLocation(country, city) }`. No `if (version === …)` ladder.

**Default version source:** add a validated `protocolVersion` to `config.ts`
(new env `ONDC_PROTOCOL_VERSION`, default `"1.2.5"`), validated against the registry
keys with the existing fail-fast aggregation. Version is a deployment/environment
property, so it belongs with the other env-driven config. A per-call `version` override
stays available for tests and mixed-version interop.

**Return type:** `OndcContext` becomes a **discriminated union on `family`**
(`OndcContext1x | OndcContext2x`). Most consumers only `JSON.stringify` the whole
object, so narrowing cost is near-zero, and an illegal shape (e.g. `version` + flat
`country`) becomes unrepresentable.

## Alternatives considered (rejected)

- **`if (version === …)` branches inside the builder** — fine for two versions, tangles
  by the third, forces editing the core for every addition. Violates Open/Closed.
- **Separate `context.v1.ts` / `context.v2.ts`** — duplicates the id/timestamp/ttl/BPP
  logic in both; this is the exact duplication we want to avoid.
- **Class hierarchy / inheritance** — overkill; the differences are declarative data, so
  composition via plain profile objects is lighter and easier to test.

## Scope of the eventual change

- New `versions.ts`: `OndcVersionId`, `VersionProfile`, `VERSION_PROFILES`, `resolveProfile()`.
- `config.ts`: add validated `protocolVersion` (env `ONDC_PROTOCOL_VERSION`).
- `context.ts`: `buildContext` gains optional `version` param, delegates variant rendering
  to the profile; return type becomes the family-discriminated union. **Invariant logic
  (ids / timestamp / ttl / BPP routing) is untouched.**
- Adding any future version = append one registry entry.

## Acceptance criteria (definition of done)

- [ ] Onboarding version confirmed and set as the config default (see open question).
- [ ] Profiles seeded for every version our environments target (at minimum the
      confirmed one; add `2.0.2` if/when relevant).
- [ ] `buildContext` contains no version conditionals — all variance lives in profiles.
- [ ] Selecting a 2.x profile produces nested `location` + `version`; selecting a 1.2.x
      profile produces flat `country`/`city` + `core_version` (snapshot/unit tested).
- [ ] Invalid `ONDC_PROTOCOL_VERSION` fails fast at config load with a clear message.
- [ ] `ONDC_CORE_VERSION` constant in `context.ts` is removed/replaced by the registry.

## Open question (blocks the multi-version refactor, not the current value)

The active Retail protocol version is confirmed as **1.2.5** (B2C domestic, flat shape),
and `context.ts` is pinned there. What remains open is whether any of our environments
must also target a **structurally different** track (B2B 2.0.2 / B2C-Exports 2.0) — that
is **not** derivable from the codebase; it lives in the ONDC NP registration / subscriber
approval. Resolving it determines whether the VersionProfile registry is needed and which
profiles to seed; it does **not** change today's `1.2.5` default.

## References

- [ONDC-RET-Specifications (official)](https://github.com/ONDC-Official/ONDC-RET-Specifications) — `release-2.0.2` search payload confirms `version` + nested `location`
- [ONDC-Protocol-Specs (official)](https://github.com/ONDC-Official/ONDC-Protocol-Specs)
- Local: [context.ts](./context.ts), [config.ts](./config.ts)
