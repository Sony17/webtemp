// Tests for the inbound-callback idempotency guard (idempotency.ts).
//
// These pin the two-phase contract that the 10 on_* callback routes depend on:
//   - peekMessageId() is READ-ONLY — it must NOT record the tuple.
//   - commitMessageId() is the only writer — call it AFTER persist succeeds.
//
// The headline case is `regression: failed persist does not mask a retry`,
// which guards the ACK-without-persistence bug: before the peek/commit split,
// recordMessageId() recorded on first sight, so a first attempt that failed to
// persist still marked the tuple seen and the sender's retry replay-ACKed
// without ever persisting. With peek/commit, a failed attempt never commits, so
// the retry is correctly treated as new and re-attempts persistence.
//
// NOTE: running this requires vitest wired up (see step 8 of the PR notes):
//   - add `vitest` to devDependencies and a `"test": "vitest run"` script
//   - alias `server-only` → empty module in vitest config (idempotency.ts has
//     `import "server-only"`), e.g. test.alias: { "server-only": "node:util" }
import { afterEach, describe, expect, it } from "vitest";
import {
  peekMessageId,
  commitMessageId,
  clearIdempotencyCache,
} from "./idempotency";

const TXN = "7c3e3dbd-71a5-47a5-bc54-1b380c816bc2";
const MSG = "m-1";

afterEach(() => {
  // Idempotency state is a module-level singleton — reset between tests so one
  // case's committed tuples can't leak into the next.
  clearIdempotencyCache();
});

describe("peekMessageId", () => {
  it("returns 'new' for an unseen tuple and does NOT record it", () => {
    expect(peekMessageId("on_search", TXN, MSG)).toEqual({ status: "new" });
    // A second peek with no commit in between must STILL be 'new' — peek is
    // read-only. (If peek recorded, this would be 'replay'.)
    expect(peekMessageId("on_search", TXN, MSG)).toEqual({ status: "new" });
  });
});

describe("commitMessageId", () => {
  it("makes a subsequent peek of the same tuple replay", () => {
    expect(peekMessageId("on_search", TXN, MSG).status).toBe("new");
    commitMessageId("on_search", TXN, MSG);

    const after = peekMessageId("on_search", TXN, MSG);
    expect(after.status).toBe("replay");
    if (after.status === "replay") {
      expect(typeof after.firstSeenAt).toBe("number");
    }
  });

  it("is idempotent: re-committing preserves the original firstSeenAt", () => {
    commitMessageId("on_search", TXN, MSG);
    const first = peekMessageId("on_search", TXN, MSG);
    commitMessageId("on_search", TXN, MSG);
    const second = peekMessageId("on_search", TXN, MSG);

    expect(first.status).toBe("replay");
    expect(second.status).toBe("replay");
    if (first.status === "replay" && second.status === "replay") {
      expect(second.firstSeenAt).toBe(first.firstSeenAt);
    }
  });

  it("scopes by (action, txn, msg): a different action is independent", () => {
    commitMessageId("on_search", TXN, MSG);
    // Same txn+msg, different action → must be treated as new.
    expect(peekMessageId("on_select", TXN, MSG).status).toBe("new");
  });
});

describe("regression: failed persist does not mask a retry", () => {
  it("re-attempts (peek 'new') when the first attempt never committed", () => {
    // First callback: peek says 'new' → route proceeds to persist…
    expect(peekMessageId("on_search", TXN, MSG).status).toBe("new");
    // …persist THROWS → route returns NACK 500 and does NOT commit.
    // (no commitMessageId call — that is the whole point)

    // Sender retries the same (txn, msg). Because the failed attempt never
    // committed, the retry must be treated as new so it re-attempts persistence
    // — NOT short-circuited to an ACK without persisting.
    expect(peekMessageId("on_search", TXN, MSG).status).toBe("new");

    // Once the retry's persist succeeds and commits, a further retry replays.
    commitMessageId("on_search", TXN, MSG);
    expect(peekMessageId("on_search", TXN, MSG).status).toBe("replay");
  });
});
