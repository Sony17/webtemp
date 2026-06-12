// ONDC inbound-callback idempotency — message_id replay detection.
//
// Workbench (and real BPPs under network retries) resends the SAME message_id
// for the SAME (action, transaction) when its previous attempt didn't get an
// ACK in time. The protocol-correct behavior is:
//   - First call: process + persist + ACK.
//   - Subsequent identical calls: ACK without re-processing — don't double-
//     persist, don't double-trigger any side effects.
//
// This module is the seam every on_* route consults right after structural
// validation. It records (action, transaction_id, message_id) tuples in a
// bounded in-memory LRU+TTL store; a second hit on the same tuple returns
// "replay" and the route ACKs without going through the persist path again.
//
// In-memory only: a Vercel cold-start container can't see another container's
// entries, so cross-container replays still re-persist. That's an acceptable
// tradeoff for now — the DB-backed store (when DATABASE_URL is configured)
// already deduplicates by composite key on writes, so the worst case is one
// extra ACK + one extra last-write-wins persist of an identical payload.
import "server-only";

// Max distinct (action, txn, msg) tuples we remember. Sized for a typical
// workbench session (hundreds of callbacks per transaction) with headroom.
const CAPACITY = 10_000;

// How long a tuple stays "seen" before we forget it. Workbench retries arrive
// within seconds; an hour is a generous safety margin and bounded enough that
// genuinely fresh message_ids issued an hour later don't trip the replay path.
const TTL_MS = 60 * 60 * 1000;

type Entry = { firstSeenAt: number; expiresAt: number };

type State = {
  // Insertion-ordered Map → cheap LRU via re-insert on access.
  seen: Map<string, Entry>;
};

declare global {
  // eslint-disable-next-line no-var
  var __ondcIdempotency__: State | undefined;
}

function getState(): State {
  if (!globalThis.__ondcIdempotency__) {
    globalThis.__ondcIdempotency__ = { seen: new Map() };
  }
  return globalThis.__ondcIdempotency__;
}

function key(action: string, transactionId: string, messageId: string): string {
  return `${action}|${transactionId}|${messageId}`;
}

export type IdempotencyVerdict =
  | { status: "new" }
  | { status: "replay"; firstSeenAt: number };

// Record (action, txn, msg) and report whether it's the first time we've seen
// this tuple. Side-effect: prunes expired entries lazily and bounds size to
// CAPACITY (oldest evicted first). NEVER throws.
export function recordMessageId(
  action: string,
  transactionId: string,
  messageId: string
): IdempotencyVerdict {
  const s = getState();
  const k = key(action, transactionId, messageId);
  const now = Date.now();

  const existing = s.seen.get(k);
  if (existing && existing.expiresAt > now) {
    return { status: "replay", firstSeenAt: existing.firstSeenAt };
  }

  // Evict the expired entry (if any) and insert fresh — re-inserting moves it
  // to the LRU tail, which matters for capacity-based eviction below.
  if (existing) s.seen.delete(k);
  s.seen.set(k, { firstSeenAt: now, expiresAt: now + TTL_MS });

  // Capacity eviction: drop oldest entries until we're under cap. Map keeps
  // insertion order, so the first key is the oldest.
  while (s.seen.size > CAPACITY) {
    const firstKey = s.seen.keys().next().value;
    if (firstKey === undefined) break;
    s.seen.delete(firstKey);
  }

  return { status: "new" };
}

// Exposed for tests + diagnostics; the routes never call it directly.
export function clearIdempotencyCache(): void {
  getState().seen.clear();
}

// ---------------------------------------------------------------------------
// Negative cache — short-circuit retries of an identical bad request.
// ---------------------------------------------------------------------------
//
// Different from the success-replay path above. ONDC retries the SAME message
// when an ACK is slow; if our first response was a NACK (missing_ttl, expired
// signature, etc.), each retry re-runs the full pipeline — registry /lookup,
// Ed25519 verify, structural validation — before issuing the same NACK again.
// During a preprod retry storm from one non-compliant BPP this costs us tens
// of redundant registry hits.
//
// We key on the inbound Authorization header. The header binds (method, path,
// host, body digest, date) into the signing string — same header bytes within
// the cache TTL = the same client retrying the same request, so replaying the
// same NACK is safe. We deliberately key on the raw header (not parsed values)
// so a forger who guessed a victim's keyId can't poison the cache: a different
// signature → different header → different cache slot.
//
// The cached entry stores ONLY what's needed to re-emit a NACK envelope: the
// HTTP status and the ONDC error block. No request body, no signing material.
const NEG_CAPACITY = 5_000;
const NEG_TTL_MS = 60 * 1000;

export type CachedNack = {
  httpStatus: number;
  error: {
    type?: string;
    code?: string;
    path?: string;
    message?: string;
  };
};

type NegEntry = { nack: CachedNack; expiresAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __ondcNegCache__: Map<string, NegEntry> | undefined;
}

function getNegState(): Map<string, NegEntry> {
  if (!globalThis.__ondcNegCache__) globalThis.__ondcNegCache__ = new Map();
  return globalThis.__ondcNegCache__;
}

// Look up a prior rejection for this Authorization header. Returns the cached
// NACK if still fresh, or null. Lazily prunes the exact key on expiry.
export function lookupRejection(authHeader: string): CachedNack | null {
  const m = getNegState();
  const entry = m.get(authHeader);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    m.delete(authHeader);
    return null;
  }
  return entry.nack;
}

// Remember that this Authorization header was rejected with this NACK so that
// an identical retry within the TTL window can skip the verify pipeline.
// Bounded by NEG_CAPACITY with oldest-first eviction (same pattern as `seen`).
export function recordRejection(authHeader: string, nack: CachedNack): void {
  const m = getNegState();
  m.set(authHeader, { nack, expiresAt: Date.now() + NEG_TTL_MS });
  while (m.size > NEG_CAPACITY) {
    const firstKey = m.keys().next().value;
    if (firstKey === undefined) break;
    m.delete(firstKey);
  }
}

export function clearNegativeCache(): void {
  getNegState().clear();
}
