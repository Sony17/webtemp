// Discovery incremental PULL — catalog_inc time-window contract.
//
// Pins the workbench certification finding (iteration 7, "Discovery incremental
// pull request" row):
//
//   "Please keep time difference for same day"
//
// The PULL refresh emits a catalog_inc tag with start_time + end_time. The
// window must sit on the SAME UTC calendar day with a real gap. The earlier
// default derived start_time from LOCAL midnight (new Date().setHours(0,0,0,0)),
// which toISOString() pushes onto the PREVIOUS UTC day for +ve-offset zones
// (e.g. IST 00:00 -> 18:30Z prior day) — so start_time and end_time landed on
// two different UTC days. buildSearchMessage now derives the default start from
// end_time's UTC date at 00:00:00Z, keeping both on one day.
import { describe, expect, it } from "vitest";
import { buildSearchMessage } from "@/app/api/ondc/search/route";

function catalogInc(msg: ReturnType<typeof buildSearchMessage>) {
  const tag = msg.intent.tags?.find((t) => t.code === "catalog_inc");
  const list = tag?.list ?? [];
  const get = (code: string) => list.find((e) => e.code === code)?.value;
  return { tag, start: get("start_time"), end: get("end_time") };
}

const dayOf = (iso: string) => iso.slice(0, 10);

describe("buildSearchMessage — incremental PULL window", () => {
  it("default start_time and end_time are on the SAME UTC day", () => {
    const { start, end } = catalogInc(
      buildSearchMessage({ incremental: true, incrementalMode: "pull" })
    );
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    // The property that was violated: same UTC calendar day.
    expect(dayOf(start!)).toBe(dayOf(end!));
    // And a real, positive gap (start strictly before end).
    expect(new Date(start!).getTime()).toBeLessThan(new Date(end!).getTime());
  });

  it("derives default start from end_time's UTC date at 00:00:00Z", () => {
    const { start, end } = catalogInc(
      buildSearchMessage({
        incremental: true,
        incrementalMode: "pull",
        incrementalEnd: "2026-07-28T09:15:00.000Z",
      })
    );
    expect(end).toBe("2026-07-28T09:15:00.000Z");
    expect(start).toBe("2026-07-28T00:00:00.000Z");
    expect(dayOf(start!)).toBe(dayOf(end!));
  });

  it("keeps same-day even for an end_time just after UTC midnight", () => {
    const { start, end } = catalogInc(
      buildSearchMessage({
        incremental: true,
        incrementalMode: "pull",
        incrementalEnd: "2026-07-28T00:00:30.000Z",
      })
    );
    expect(start).toBe("2026-07-28T00:00:00.000Z");
    expect(dayOf(start!)).toBe(dayOf(end!));
    expect(new Date(start!).getTime()).toBeLessThan(new Date(end!).getTime());
  });

  it("respects an explicit incrementalStart when provided", () => {
    const { start, end } = catalogInc(
      buildSearchMessage({
        incremental: true,
        incrementalMode: "pull",
        incrementalStart: "2026-07-28T02:00:00.000Z",
        incrementalEnd: "2026-07-28T18:00:00.000Z",
      })
    );
    expect(start).toBe("2026-07-28T02:00:00.000Z");
    expect(end).toBe("2026-07-28T18:00:00.000Z");
  });

  it("PUSH start mode carries a mode entry, not an end_time window", () => {
    const { tag, end } = catalogInc(
      buildSearchMessage({ incremental: true, incrementalMode: "start" })
    );
    expect(tag?.list.some((e) => e.code === "mode" && e.value === "start")).toBe(true);
    expect(end).toBeUndefined();
  });
});
