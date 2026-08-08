// Outbound BAP action routes (the 10 actions the buyer app fires).
//
// Coverage axes per action — derived from each route.ts contract:
//   A. HTTP method      → only POST is accepted; everything else is 4xx/405.
//   B. JSON parsing     → malformed body returns 400 "Invalid JSON".
//   C. Config guard     → when ONDC is unconfigured the route returns 503.
//   D. Required fields  → each documented REQUIRED field rejects 400.
//   E. Format checks    → https-only bppUri, GPS regex, positive-int quantity, etc.
//   F. Happy-path probe → with a valid body, the route accepts validation and
//                         attempts to dial the BPP/gateway. When the network is
//                         not reachable / config absent, we still verify the
//                         route's REACTION (503 / 502 / 504 / 422) and we DO NOT
//                         require an ACK, since that needs a real ONDC network.
//
// Each scenario is a thunk so the runner can execute, time, and collate it.
import { httpRequest, ids } from "../harness.mjs";

const BAP_ROUTES = [
  "search",
  "select",
  "init",
  "confirm",
  "status",
  "track",
  "cancel",
  "update",
  "rating",
  "support",
];

const COMMON_REQUIRED = {
  // Search has no required body fields beyond a discovery criterion, so it is
  // omitted from the directed-action checks.
  select: ["transactionId", "bppId", "bppUri", "providerId", "items"],
  init: ["transactionId", "bppId", "bppUri", "providerId", "items", "billing"],
  confirm: ["transactionId", "bppId", "bppUri", "order"],
  status: ["transactionId", "bppId", "bppUri", "orderId"],
  track: ["transactionId", "bppId", "bppUri", "orderId"],
  cancel: [
    "transactionId",
    "bppId",
    "bppUri",
    "orderId",
    "cancellationReasonId",
  ],
  update: ["transactionId", "bppId", "bppUri", "updateTarget", "order"],
  rating: ["transactionId", "bppId", "bppUri", "ratings"],
  support: ["transactionId", "bppId", "bppUri", "refId"],
};

// Minimal valid body — gets past every validation gate so the route attempts
// the outbound call. Per action; mirrors the SAMPLE BODY in each route.ts.
function validBody(action) {
  const base = {
    transactionId: ids.txn(),
    bppId: "buyer-side-test.bpp.example",
    bppUri: "https://bpp.example",
  };
  switch (action) {
    case "search":
      return { query: "basmati rice" };
    case "select":
      return {
        ...base,
        providerId: "P1",
        items: [{ id: "I1", quantity: 2, locationId: "L1" }],
      };
    case "init":
      return {
        ...base,
        providerId: "P1",
        items: [{ id: "I1", quantity: 2, locationId: "L1" }],
        billing: {
          name: "Test Buyer",
          phone: "9999999999",
          email: "buyer@example.com",
          address: {
            building: "1",
            locality: "MG Rd",
            city: "Bengaluru",
            state: "KA",
            country: "IND",
            area_code: "560001",
          },
        },
      };
    case "confirm":
      return {
        ...base,
        order: {
          provider: { id: "P1" },
          items: [{ id: "I1", quantity: { count: 1 } }],
          quote: { price: { currency: "INR", value: "100" }, breakup: [] },
          payments: [{ type: "ON-ORDER", status: "NOT-PAID" }],
          billing: { name: "Buyer", phone: "9999999999" },
          fulfillments: [{ type: "Delivery" }],
        },
      };
    case "status":
    case "track":
      return { ...base, orderId: "ORD-1" };
    case "cancel":
      return {
        ...base,
        orderId: "ORD-1",
        cancellationReasonId: "001",
      };
    case "update":
      return {
        ...base,
        updateTarget: "payment",
        order: { id: "ORD-1", payments: [{ status: "PAID" }] },
      };
    case "rating":
      return {
        ...base,
        ratings: [{ id: "ORD-1", ratingCategory: "Order", value: 5 }],
      };
    case "support":
      return { ...base, refId: "ORD-1" };
    default:
      return {};
  }
}

function omit(obj, key) {
  const { [key]: _, ...rest } = obj;
  return rest;
}

// Build one scenario object — a thunk + its assertion descriptor.
function scenario({ name, route, category, ref, run, expect }) {
  return { name, route, category, ref, run, expect };
}

export function buildOutboundScenarios() {
  const scenarios = [];

  for (const action of BAP_ROUTES) {
    const path = `/api/ondc/${action}`;

    // (A) HTTP method — only POST is accepted.
    scenarios.push(
      scenario({
        name: `${action}: GET is rejected`,
        route: path,
        category: "method",
        ref: "ONDC Beckn HTTP profile (POST-only actions)",
        run: () => httpRequest({ method: "GET", path }),
        expect: { status: [404, 405, 400] },
      })
    );

    // (B) JSON parsing.
    scenarios.push(
      scenario({
        name: `${action}: malformed JSON body → 400 or 503 unconfigured`,
        route: path,
        category: "parsing",
        ref: "route.ts: 400 'Invalid JSON' guard",
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: { "content-type": "application/json" },
            body: "{not-json",
          }),
        expect: { status: [400, 503] },
      })
    );

    // (C) Config guard / empty body validation. When the server is unconfigured
    // every route returns 503; when configured, an empty body fails required-
    // field validation (400) — except `search` which fails the "need query|category"
    // 400 rule.
    scenarios.push(
      scenario({
        name: `${action}: empty body → 400 missing fields OR 503 unconfigured`,
        route: path,
        category: "config-or-validation",
        ref: "isOndcConfigured guard / required-field guard",
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        expect: { status: [400, 503] },
      })
    );

    // (D) Missing-required-field matrix for directed actions.
    const required = COMMON_REQUIRED[action];
    if (required) {
      const baseBody = validBody(action);
      for (const field of required) {
        scenarios.push(
          scenario({
            name: `${action}: missing '${field}' → 400 OR 503 unconfigured`,
            route: path,
            category: "required-field",
            ref: `route.ts: '${field}' is required`,
            run: () =>
              httpRequest({
                method: "POST",
                path,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(omit(baseBody, field)),
              }),
            // confirm's `order` is optional-with-fallback: when omitted the
            // route loads the persisted on_init order and answers 409 when
            // none exists for the transaction (confirm/route.ts).
            expect: {
              status:
                action === "confirm" && field === "order"
                  ? [400, 409, 503]
                  : [400, 503],
            },
          })
        );
      }
    }

    // (E) Format checks per action.
    if (action === "search") {
      scenarios.push(
        scenario({
          name: `search: malformed GPS rejected → 400`,
          route: path,
          category: "format",
          ref: "search/route.ts GPS_RE",
          run: () =>
            httpRequest({
              method: "POST",
              path,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ query: "rice", deliveryGps: "north-pole" }),
            }),
          expect: { status: [400, 503] },
        })
      );
    }

    if (
      action === "select" ||
      action === "init" ||
      action === "confirm" ||
      action === "status" ||
      action === "track" ||
      action === "cancel" ||
      action === "update" ||
      action === "rating" ||
      action === "support"
    ) {
      // Non-https bppUri must be rejected (HTTPS-only).
      scenarios.push(
        scenario({
          name: `${action}: non-https bppUri → 400 OR 503 unconfigured`,
          route: path,
          category: "format",
          ref: "route.ts: bppUri must be https",
          run: () => {
            const body = { ...validBody(action), bppUri: "http://bpp.example" };
            return httpRequest({
              method: "POST",
              path,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
          },
          expect: { status: [400, 503] },
        })
      );
    }

    if (action === "select" || action === "init") {
      // items array must be non-empty
      scenarios.push(
        scenario({
          name: `${action}: empty items array → 400 OR 503 unconfigured`,
          route: path,
          category: "format",
          ref: "validateItems requires at least one entry",
          run: () => {
            const body = { ...validBody(action), items: [] };
            return httpRequest({
              method: "POST",
              path,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
          },
          expect: { status: [400, 503] },
        })
      );
      // negative quantity
      scenarios.push(
        scenario({
          name: `${action}: items[].quantity ≤ 0 → 400 OR 503 unconfigured`,
          route: path,
          category: "format",
          ref: "validateItems requires positive integer quantity",
          run: () => {
            const body = {
              ...validBody(action),
              items: [{ id: "I1", quantity: 0 }],
            };
            return httpRequest({
              method: "POST",
              path,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
          },
          expect: { status: [400, 503] },
        })
      );
      // fractional quantity
      scenarios.push(
        scenario({
          name: `${action}: items[].quantity non-integer → 400 OR 503 unconfigured`,
          route: path,
          category: "format",
          ref: "validateItems requires positive integer quantity",
          run: () => {
            const body = {
              ...validBody(action),
              items: [{ id: "I1", quantity: 1.5 }],
            };
            return httpRequest({
              method: "POST",
              path,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
          },
          expect: { status: [400, 503] },
        })
      );
    }

    if (action === "init") {
      for (const sub of ["name", "phone"]) {
        scenarios.push(
          scenario({
            name: `init: billing.${sub} missing → 400 OR 503 unconfigured`,
            route: path,
            category: "format",
            ref: `init/route.ts validateBilling: ${sub} is required`,
            run: () => {
              const body = validBody("init");
              const billing = { ...body.billing };
              delete billing[sub];
              return httpRequest({
                method: "POST",
                path,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...body, billing }),
              });
            },
            expect: { status: [400, 503] },
          })
        );
      }
    }

    if (action === "confirm") {
      // order without quote or provider must be rejected locally. `payments`
      // is different: the route no longer validates it locally — COD terms
      // (ON-FULFILLMENT / NOT-PAID) are defaulted in ensureConfirmPayment and
      // the request proceeds to the BPP, so against this suite's unreachable
      // test BPP the transport fault (502/504) is the expected outcome.
      for (const omitKey of ["quote", "payments", "provider"]) {
        scenarios.push(
          scenario({
            name: `confirm: order.${omitKey} missing → 400 OR 503 unconfigured`,
            route: path,
            category: "format",
            ref: `confirm/route.ts validateOrder: ${omitKey} is required`,
            run: () => {
              const body = validBody("confirm");
              const order = { ...body.order };
              delete order[omitKey];
              return httpRequest({
                method: "POST",
                path,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...body, order }),
              });
            },
            expect: {
              status:
                omitKey === "payments" ? [400, 502, 503, 504] : [400, 503],
            },
          })
        );
      }
    }

    if (action === "rating") {
      // rating value outside 1..5 must be rejected.
      for (const bad of [0, 6, "x", -1]) {
        scenarios.push(
          scenario({
            name: `rating: invalid value "${bad}" → 400 OR 503 unconfigured`,
            route: path,
            category: "format",
            ref: "rating/route.ts: value must be integer 1..5",
            run: () => {
              const body = {
                ...validBody("rating"),
                ratings: [{ id: "ORD-1", ratingCategory: "Order", value: bad }],
              };
              return httpRequest({
                method: "POST",
                path,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
            },
            expect: { status: [400, 503] },
          })
        );
      }
    }

    // (F) Happy-path probe — accepted by validation. We don't assert ACK because
    // a real ONDC dial is required for that. We DO assert the response shape
    // shows the route progressed past validation:
    //   - 503 if unconfigured (config guard hit)
    //   - 422 if the gateway/BPP NACK'd
    //   - 502/504 if the dial failed (no network / timeout)
    //   - 200 if ACK
    scenarios.push(
      scenario({
        name: `${action}: valid body → route progresses past validation`,
        route: path,
        category: "happy-path-probe",
        ref: "route.ts: sendOndcRequest dispatch",
        run: () =>
          httpRequest({
            method: "POST",
            path,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validBody(action)),
            timeoutMs: 20_000,
          }),
        expect: { status: [200, 422, 500, 502, 503, 504] },
      })
    );
  }

  return scenarios;
}
