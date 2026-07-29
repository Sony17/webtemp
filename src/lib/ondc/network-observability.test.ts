// Tests for the pure, side-effect-free pieces of Network Observability:
// scrubPersonalData() and buildObservabilityPayload(). The submission path
// (fetch) and env-driven config are not exercised here — these pin the two
// functions that decide WHAT leaves the app, which is the part that matters for
// the Open Data Framework's "remove Personal Data" requirement.
import { describe, it, expect } from "vitest";
import {
  scrubPersonalData,
  buildObservabilityEvents,
  type ObservabilityRecord,
} from "./network-observability";

describe("scrubPersonalData", () => {
  it("redacts personal leaf fields wherever they nest", () => {
    const order = {
      billing: {
        name: "Asha Rao",
        phone: "9876543210",
        email: "asha@example.com",
        address: {
          building: "42 Rose Villa",
          locality: "Indiranagar",
          city: "Bengaluru",
          state: "KA",
          area_code: "560038",
        },
      },
    };
    const scrubbed = scrubPersonalData(order) as typeof order;

    expect(scrubbed.billing.name).toBe("[REDACTED]");
    expect(scrubbed.billing.phone).toBe("[REDACTED]");
    expect(scrubbed.billing.email).toBe("[REDACTED]");
    expect(scrubbed.billing.address.building).toBe("[REDACTED]");
    expect(scrubbed.billing.address.locality).toBe("[REDACTED]");
    // Coarse, non-identifying location the collector keys on is preserved.
    expect(scrubbed.billing.address.city).toBe("Bengaluru");
    expect(scrubbed.billing.address.state).toBe("KA");
    expect(scrubbed.billing.address.area_code).toBe("560038");
  });

  it("redacts personal fields inside arrays (fulfillments)", () => {
    const payload = {
      fulfillments: [
        { end: { contact: { phone: "9999999999", email: "x@y.com" } } },
        { end: { contact: { phone: "8888888888" } } },
      ],
    };
    const scrubbed = scrubPersonalData(payload) as typeof payload;
    expect(scrubbed.fulfillments[0].end.contact.phone).toBe("[REDACTED]");
    expect(scrubbed.fulfillments[0].end.contact.email).toBe("[REDACTED]");
    expect(scrubbed.fulfillments[1].end.contact.phone).toBe("[REDACTED]");
  });

  it("masks gps to coarse precision rather than removing it", () => {
    const scrubbed = scrubPersonalData({ gps: "12.971599,77.594625" }) as {
      gps: string;
    };
    expect(scrubbed.gps).toBe("12.97,77.59");
  });

  it("redacts a non-parseable gps value", () => {
    const scrubbed = scrubPersonalData({ gps: "not-a-coordinate" }) as {
      gps: string;
    };
    expect(scrubbed.gps).toBe("[REDACTED]");
  });

  it("is case-insensitive on key names", () => {
    const scrubbed = scrubPersonalData({
      billing: { Name: "Bob", PHONE: "12345" },
    }) as { billing: Record<string, string> };
    expect(scrubbed.billing.Name).toBe("[REDACTED]");
    expect(scrubbed.billing.PHONE).toBe("[REDACTED]");
  });

  it("redacts person names but keeps provider/item descriptor names", () => {
    const payload = {
      provider: { id: "P1", descriptor: { name: "Sri Stores" } },
      items: [{ id: "I1", descriptor: { name: "Aashirvaad Atta 5kg" } }],
      billing: { name: "Asha Rao" },
      fulfillments: [{ end: { person: { name: "Asha Rao" } } }],
    };
    const s = scrubPersonalData(payload) as typeof payload;
    // Descriptor names ONDC needs for Seller/SKU-growth metrics are preserved…
    expect(s.provider.descriptor.name).toBe("Sri Stores");
    expect(s.items[0].descriptor.name).toBe("Aashirvaad Atta 5kg");
    // …while person names (billing, fulfillment person) are still removed.
    expect(s.billing.name).toBe("[REDACTED]");
    expect(s.fulfillments[0].end.person.name).toBe("[REDACTED]");
  });

  it("does not mutate its input", () => {
    const input = { name: "Asha", nested: { email: "a@b.com" } };
    const copy = JSON.parse(JSON.stringify(input));
    scrubPersonalData(input);
    expect(input).toEqual(copy);
  });

  it("passes primitives and non-personal fields through untouched", () => {
    expect(scrubPersonalData("hello")).toBe("hello");
    expect(scrubPersonalData(42)).toBe(42);
    expect(scrubPersonalData(null)).toBe(null);
    const kept = scrubPersonalData({ id: "P1", quantity: 2, city: "std:080" });
    expect(kept).toEqual({ id: "P1", quantity: 2, city: "std:080" });
  });
});

describe("buildObservabilityEvents", () => {
  const record: ObservabilityRecord = {
    direction: "inbound",
    action: "on_confirm",
    transactionId: "txn-1",
    messageId: "msg-1",
    bppId: "seller.example.com",
    requestBody: JSON.stringify({
      context: { action: "on_confirm", transaction_id: "txn-1" },
      message: { order: { billing: { name: "Asha", phone: "999" } } },
    }),
    responseBody: { message: { ack: { status: "ACK" } } },
    httpStatus: 200,
    ackStatus: "ACK",
    recordedAt: "2026-07-29T00:00:00.000Z",
  };

  it("emits a {type,data} request event plus a <action>_response event", () => {
    const events = buildObservabilityEvents(record);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("on_confirm");
    expect(events[1].type).toBe("on_confirm_response");

    // The request event's data is the RAW ONDC payload (context + message),
    // scrubbed — not wrapped in any envelope.
    const reqData = events[0].data as {
      context: { transaction_id: string };
      message: { order: { billing: { name: string; phone: string } } };
    };
    expect(reqData.context.transaction_id).toBe("txn-1");
    expect(reqData.message.order.billing.name).toBe("[REDACTED]");
    expect(reqData.message.order.billing.phone).toBe("[REDACTED]");

    // The response event's data carries the SAME context as the request (with
    // the base action, per the NO schema) plus the ACK/NACK envelope.
    expect(events[1].data).toEqual({
      context: { action: "on_confirm", transaction_id: "txn-1" },
      message: { ack: { status: "ACK" } },
    });
  });

  it("carries an error onto the response event on a NACK", () => {
    const events = buildObservabilityEvents({
      ...record,
      responseBody: {
        message: { ack: { status: "NACK" } },
        error: { type: "DOMAIN-ERROR", code: "30009" },
      },
    });
    expect(events[1].data).toEqual({
      context: { action: "on_confirm", transaction_id: "txn-1" },
      message: { ack: { status: "NACK" } },
      error: { type: "DOMAIN-ERROR", code: "30009" },
    });
  });

  it("omits the response event when no response body was captured", () => {
    const events = buildObservabilityEvents({ ...record, responseBody: null });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("on_confirm");
  });

  it("keeps a non-JSON request body as raw string data", () => {
    const events = buildObservabilityEvents({
      ...record,
      requestBody: "<<not json>>",
      responseBody: null,
    });
    expect(events[0].data).toBe("<<not json>>");
  });
});
