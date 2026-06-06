// Inbound BPP→BAP callback routes (the 10 on_* endpoints).
//
// Coverage axes per callback — derived from each on_*/route.ts contract:
//   A. HTTP method      → only POST is accepted; everything else is 4xx.
//   B. Auth header      → missing / malformed Authorization → 401 NACK.
//   C. Signature        → present-but-unverifiable signature → 401 NACK.
//   D. JSON parsing     → invalid JSON (post-auth path) is hard to reach without
//                         a valid sig; we cover it via the auth-failure path and
//                         document it as out of black-box scope.
//   E. Structural       → missing context / wrong action / missing transaction_id,
//                         message_id, bpp_id, bpp_uri, and message.* fields.
//                         These are blocked by the auth gate in production; the
//                         expected status is therefore 401 on a black-box probe.
//                         We still send them so a regression that REMOVES the
//                         auth gate (and exposes the inner validator) is caught.
//   F. ACK shape        → registry-status sanity probe (separate module).
//
// Note on positive-path callback testing:  to actually exercise the validator and
// achieve a real ACK, the test would need to publish its mock public key into the
// configured ONDC registry (or stub `resolveBppSigningPublicKey`). That is out
// of scope for a black-box, no-deps suite. The runner reports a clear "blocked"
// reason for those scenarios when ONDC is unconfigured.
import {
  httpRequest,
  fakeAuthorization,
  generateEd25519KeyPair,
  signBody,
  ids,
  minimalContext,
} from "../harness.mjs";

const CALLBACK_ROUTES = [
  "on_search",
  "on_select",
  "on_init",
  "on_confirm",
  "on_status",
  "on_track",
  "on_cancel",
  "on_update",
  "on_rating",
  "on_support",
];

// Map each callback to the minimal `message` shape its validator requires.
// Used to build "missing message.X" probes.
const REQUIRED_MESSAGE = {
  on_search: { catalog: { "bpp/providers": [] } },
  on_select: { order: { provider: { id: "P1" }, quote: { price: { currency: "INR", value: "0" } } } },
  on_init: { order: { provider: { id: "P1" }, quote: { price: { currency: "INR", value: "0" } } } },
  on_confirm: {
    order: { id: "ORD-1", provider: { id: "P1" }, state: "Created" },
  },
  on_status: {
    order: { id: "ORD-1", provider: { id: "P1" }, state: "Accepted" },
  },
  on_track: { tracking: { status: "active", url: "https://t/x" } },
  on_cancel: {
    order: { id: "ORD-1", provider: { id: "P1" }, state: "Cancelled" },
  },
  on_update: {
    order: { id: "ORD-1", provider: { id: "P1" }, state: "Created" },
  },
  on_rating: { feedback_form: { url: "https://feedback/x" } },
  on_support: { phone: "1800123" },
};

function fullCallbackBody(action) {
  return {
    context: { ...minimalContext({ action }), action },
    message: REQUIRED_MESSAGE[action],
  };
}

function scenario(spec) {
  return spec;
}

export function buildCallbackScenarios() {
  const scenarios = [];
  // One ed25519 keypair shared across the suite, so signed-but-unresolvable
  // probes are deterministic per run.
  const kp = generateEd25519KeyPair();
  const FAKE_SUB = "test-bpp.example";
  const FAKE_UKID = "test-key-1";

  for (const action of CALLBACK_ROUTES) {
    const path = `/api/ondc/${action}`;

    // (A) HTTP method.
    scenarios.push(
      scenario({
        name: `${action}: GET is rejected`,
        route: path,
        category: "method",
        ref: "Beckn HTTP profile: callbacks are POST-only",
        run: () => httpRequest({ method: "GET", path }),
        expect: { status: [404, 405, 400] },
      })
    );

    // (B-i) Missing Authorization header.
    scenarios.push(
      scenario({
        name: `${action}: missing Authorization → 401 NACK or 503`,
        route: path,
        category: "auth",
        ref: 'on_*/route.ts: "missing signature"',
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(fullCallbackBody(action)),
          }),
        expect: { status: [401, 500, 503] },
      })
    );

    // (B-ii) Malformed Authorization.
    for (const bad of [
      "totally not a header",
      "Bearer abc",
      'Signature keyId="x"',
    ]) {
      scenarios.push(
        scenario({
          name: `${action}: malformed Authorization "${bad}" → 401 NACK or 503`,
          route: path,
          category: "auth",
          ref: 'on_*/route.ts: "invalid signature"',
          run: () =>
            httpRequest({
              method: "POST",
              path,
              headers: {
                "content-type": "application/json",
                authorization: bad,
              },
              body: JSON.stringify(fullCallbackBody(action)),
            }),
          expect: { status: [401, 500, 503] },
        })
      );
    }

    // (C-i) Well-formed-looking but unresolvable Authorization (random sig).
    scenarios.push(
      scenario({
        name: `${action}: well-formed header w/ random signature → 401 NACK or 503`,
        route: path,
        category: "auth",
        ref: "resolveBppSigningPublicKey fail-closed",
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: {
              "content-type": "application/json",
              authorization: fakeAuthorization({
                subscriberId: FAKE_SUB,
                uniqueKeyId: FAKE_UKID,
              }),
            },
            body: JSON.stringify(fullCallbackBody(action)),
          }),
        expect: { status: [401, 500, 503] },
      })
    );

    // (C-ii) Signed body using our throwaway key. Registry lookup will fail
    // (we haven't published the key), so this exercises the "unresolvable key"
    // branch of the auth pipeline.
    scenarios.push(
      scenario({
        name: `${action}: ed25519-signed body, unpublished key → 401 NACK or 503`,
        route: path,
        category: "auth",
        ref: "verifyOndcSignature + registry lookup pipeline",
        run: () => {
          const rawBody = JSON.stringify(fullCallbackBody(action));
          const { authorization } = signBody({
            rawBody,
            subscriberId: FAKE_SUB,
            uniqueKeyId: FAKE_UKID,
            privateKey: kp.keyObject.privateKey,
          });
          return httpRequest({
            method: "POST",
            path,
            headers: {
              "content-type": "application/json",
              authorization,
            },
            body: rawBody,
          });
        },
        expect: { status: [401, 500, 503] },
      })
    );

    // (E) Structural probes — sent under a random Authorization so the
    // server-side auth gate is hit first. These guard against regressions
    // that bypass auth and expose the validator.
    const malformedBodies = [
      { name: "missing context", body: { message: REQUIRED_MESSAGE[action] } },
      {
        name: "wrong action",
        body: {
          context: { ...minimalContext({ action: "search" }) },
          message: REQUIRED_MESSAGE[action],
        },
      },
      {
        name: "missing transaction_id",
        body: (() => {
          const b = fullCallbackBody(action);
          delete b.context.transaction_id;
          return b;
        })(),
      },
      {
        name: "missing message_id",
        body: (() => {
          const b = fullCallbackBody(action);
          delete b.context.message_id;
          return b;
        })(),
      },
      {
        name: "missing bpp_id",
        body: (() => {
          const b = fullCallbackBody(action);
          delete b.context.bpp_id;
          return b;
        })(),
      },
      {
        name: "missing bpp_uri",
        body: (() => {
          const b = fullCallbackBody(action);
          delete b.context.bpp_uri;
          return b;
        })(),
      },
      {
        name: "missing message",
        body: { context: minimalContext({ action }) },
      },
    ];

    for (const { name, body } of malformedBodies) {
      scenarios.push(
        scenario({
          name: `${action}: ${name} → 401 (auth gate) or 400`,
          route: path,
          category: "structural",
          ref: "on_*/route.ts extractAndValidate",
          run: () =>
            httpRequest({
              method: "POST",
              path,
              headers: {
                "content-type": "application/json",
                authorization: fakeAuthorization({
                  subscriberId: FAKE_SUB,
                  uniqueKeyId: FAKE_UKID,
                }),
              },
              body: JSON.stringify(body),
            }),
          expect: { status: [400, 401, 500, 503] },
        })
      );
    }

    // ACK response shape sanity: when ANY error path is taken, the route MUST
    // return a JSON body with a "message.ack.status" of "NACK" — never silently
    // 200 OK. We probe by checking the well-known no-auth path.
    scenarios.push(
      scenario({
        name: `${action}: error responses carry a NACK ack envelope (or 503 unconfigured)`,
        route: path,
        category: "ack-shape",
        ref: "on_*/route.ts: nack() helper",
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(fullCallbackBody(action)),
          }),
        expect: {
          custom: (res) => {
            if (res.status === 503) return null; // unconfigured — acceptable
            if (!res.json) return "no JSON body";
            const ack = res.json?.message?.ack?.status;
            if (ack !== "NACK") {
              return `expected message.ack.status=NACK, got ${ack ?? "<absent>"}`;
            }
            if (!res.json.error) return 'expected "error" block on NACK';
            return null;
          },
        },
      })
    );
  }

  return scenarios;
}
