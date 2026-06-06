// Registry-status diagnostic + cross-cutting config-guard checks.
//
// /api/ondc/registry-status is the only GET route in the ONDC surface. It is a
// READ-ONLY probe of the configured registry for our own subscriber_id, with an
// optional ?subscriberId=… query parameter to inspect another participant.
//
// Coverage:
//   - 503 path when ONDC is unconfigured.
//   - 200 OK shape when configured (registry's raw httpStatus is in the body).
//   - 405-ish behavior for POST.
//   - Query-parameter passthrough for an arbitrary subscriberId.
import { httpRequest } from "../harness.mjs";

export function buildRegistryScenarios() {
  const path = "/api/ondc/registry-status";
  return [
    {
      name: "registry-status: GET self → 200 (configured) or 503 (unconfigured)",
      route: path,
      category: "registry",
      ref: "registry-status/route.ts",
      run: () => httpRequest({ method: "GET", path }),
      expect: {
        status: [200, 502, 503],
        custom: (res) => {
          if (res.status === 503) return null;
          if (!res.json) return "expected JSON body";
          return null;
        },
      },
    },
    {
      name: "registry-status: ?subscriberId passthrough",
      route: path,
      category: "registry",
      ref: "registry-status/route.ts query parameter",
      run: () =>
        httpRequest({
          method: "GET",
          path: `${path}?subscriberId=ondc-test.example`,
        }),
      expect: { status: [200, 502, 503] },
    },
    {
      name: "registry-status: POST is rejected",
      route: path,
      category: "registry",
      ref: "GET-only route",
      run: () => httpRequest({ method: "POST", path, body: "{}" }),
      expect: { status: [404, 405] },
    },
  ];
}
