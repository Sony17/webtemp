// IGM actors — interfacing NP person guarantee.
//
// Pins the fix for the workbench certification finding (iteration 7, both
// "Delivery flow with IGM" flows):
//
//   "issue — For interfacing NP person details missing in actors section"
//
// Root cause: follow-up issue calls (RESOLUTION_ACCEPT / CLOSE / …) reuse the
// actor set persisted from the SELLER's on_issue snapshot (see
// on_issue/route.ts persisting `issue` verbatim, and issue/route.ts reusing it
// when it already has >= 3 actors). The seller can echo our INTERFACING_NP
// actor WITHOUT `person` (person is optional on the IGM wire). Only OPEN, which
// builds actors fresh via buildActors, ever carried person — which is exactly
// why local single-shot testing looked green while the workbench (observing the
// full deployed lifecycle) flagged the follow-ups.
//
// ensureInterfacingNpPerson re-asserts full org/person/contact on OUR
// INTERFACING_NP actor on every call, preserving an existing person name and
// leaving all other actor types untouched.
import { describe, expect, it } from "vitest";
import {
  ensureInterfacingNpPerson,
  buildActors,
  type IssueActor,
} from "./igm-builders";

const FILL = {
  bapId: "openidea.co.in",
  personName: "Asha K",
  phone: "9876543210",
  email: "asha@example.com",
};

// A seller-echoed snapshot: 3 actors, and crucially the INTERFACING_NP actor
// has NO `person` — the exact shape that produced the QA finding.
function sellerSnapshotMissingPerson(): IssueActor[] {
  return [
    {
      id: "consumer-1",
      type: "CONSUMER",
      info: {
        org: { name: "openidea.co.in" },
        person: { name: "Asha K" },
        contact: { phone: "9876543210", email: "asha@example.com" },
      },
    },
    {
      id: "openidea.co.in",
      type: "INTERFACING_NP",
      // person deliberately absent — this is what the seller echoed back.
      info: {
        org: { name: "openidea.co.in" },
        contact: { phone: "9876543210", email: "asha@example.com" },
      },
    },
    {
      id: "staging-automation.ondc.org",
      type: "COUNTERPARTY_NP",
      info: {
        org: { name: "staging-automation.ondc.org" },
        person: { name: "Seller Agent" },
        contact: { phone: "1112223333", email: "seller@x.in" },
      },
    },
  ];
}

describe("ensureInterfacingNpPerson", () => {
  it("adds person to a person-less INTERFACING_NP actor (the QA failure case)", () => {
    const before = sellerSnapshotMissingPerson();
    expect(
      before.find((a) => a.type === "INTERFACING_NP")!.info.person
    ).toBeUndefined();

    const after = ensureInterfacingNpPerson(before, FILL);
    const inp = after.find((a) => a.type === "INTERFACING_NP")!;

    expect(inp.info.person).toEqual({ name: "Asha K" });
    expect(inp.info.org).toEqual({ name: "openidea.co.in" });
    expect(inp.info.contact).toEqual({
      phone: "9876543210",
      email: "asha@example.com",
    });
  });

  it("preserves an already-present interfacing NP person name", () => {
    const actors = buildActors({
      bapId: "openidea.co.in",
      bppId: "staging-automation.ondc.org",
      consumer: { name: "Asha K", phone: "9876543210", email: "asha@example.com" },
      interfacingPersonName: "Support Desk",
    });
    const after = ensureInterfacingNpPerson(actors, FILL);
    expect(
      after.find((a) => a.type === "INTERFACING_NP")!.info.person
    ).toEqual({ name: "Support Desk" });
  });

  it("leaves CONSUMER and COUNTERPARTY_NP actors untouched", () => {
    const before = sellerSnapshotMissingPerson();
    const after = ensureInterfacingNpPerson(before, FILL);
    expect(after.find((a) => a.type === "CONSUMER")).toEqual(
      before.find((a) => a.type === "CONSUMER")
    );
    expect(after.find((a) => a.type === "COUNTERPARTY_NP")).toEqual(
      before.find((a) => a.type === "COUNTERPARTY_NP")
    );
  });

  it("falls back to empty email when neither snapshot nor fill provides one", () => {
    const actors: IssueActor[] = [
      {
        id: "openidea.co.in",
        type: "INTERFACING_NP",
        info: { org: { name: "openidea.co.in" }, contact: { phone: "", email: "" } },
      },
    ];
    const after = ensureInterfacingNpPerson(actors, {
      bapId: "openidea.co.in",
      personName: "Asha K",
      phone: "9876543210",
      // email omitted
    });
    expect(after[0].info.person).toEqual({ name: "Asha K" });
    expect(after[0].info.contact.email).toBe("");
    expect(after[0].info.contact.phone).toBe("9876543210");
  });
});
