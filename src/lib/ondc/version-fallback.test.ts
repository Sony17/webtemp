// Unit tests for the version-field NACK detector — the trigger that decides
// whether a directed action retries under the `version` field. It must be
// NARROW: a false positive would pointlessly re-send normal business NACKs
// (item unavailable, not serviceable) under a different envelope, so every
// ordinary rejection must read as false.
import { describe, expect, it } from "vitest";
import { isVersionFieldNack } from "./version-fallback";

describe("isVersionFieldNack — fires only on protocol-version rejections", () => {
  it("fires on the observed ONDC code 50004", () => {
    expect(
      isVersionFieldNack({
        code: "50004",
        message: "Core version not supported. Required 1.2.0 or more",
      })
    ).toBe(true);
  });

  it("fires on code 50004 even with no message", () => {
    expect(isVersionFieldNack({ code: "50004" })).toBe(true);
  });

  it("fires on a version-phrased message when the code is absent/different", () => {
    expect(
      isVersionFieldNack({ message: "Core version not supported" })
    ).toBe(true);
    expect(
      isVersionFieldNack({ message: "core_version is required" })
    ).toBe(true);
    expect(
      isVersionFieldNack({ message: "Unsupported version 1.2.5" })
    ).toBe(true);
  });

  it("tolerates surrounding whitespace on the code", () => {
    expect(isVersionFieldNack({ code: "  50004 " })).toBe(true);
  });

  it("does NOT fire on ordinary business NACKs", () => {
    expect(
      isVersionFieldNack({ code: "40002", message: "Item not available" })
    ).toBe(false);
    expect(
      isVersionFieldNack({
        code: "30009",
        message: "Location not serviceable for the given pincode",
      })
    ).toBe(false);
    expect(
      isVersionFieldNack({
        code: "60001",
        message: "Order value below the minimum",
      })
    ).toBe(false);
  });

  it("does NOT fire when the message mentions version but nothing is wrong with it", () => {
    // "version" alone is not enough — it must co-occur with a rejection phrase.
    expect(
      isVersionFieldNack({ message: "Catalog version updated" })
    ).toBe(false);
  });

  it("does NOT fire on an empty or missing error", () => {
    expect(isVersionFieldNack(undefined)).toBe(false);
    expect(isVersionFieldNack({})).toBe(false);
    expect(isVersionFieldNack({ code: "" })).toBe(false);
  });
});
