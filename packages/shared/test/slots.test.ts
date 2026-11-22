import { describe, it, expect } from "vitest";
import { nextFreeSlot } from "../src/slots";

// WIB = UTC+7
// nowWib = "2026-11-22 11:00 WIB" = 2026-11-22T04:00:00Z
const slotTimes = ["06:00", "12:00", "16:00", "19:00"];
const minLeadMin = 15;

describe("nextFreeSlot", () => {
  it("returns next available slot today that is > minLeadMin from now", () => {
    // Now = 11:00 WIB, so 06:00 is past, 12:00 is > 15 min away → should return 12:00 today
    const nowWib = new Date("2026-11-22T04:00:00Z"); // 11:00 WIB
    const occupied = new Set<string>();
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-22@12:00");
    expect(result.candidate.toISOString()).toBe("2026-11-22T05:00:00.000Z"); // 12:00 WIB = UTC+7 offset
  });

  it("skips past slots (earlier than now)", () => {
    // Now = 17:00 WIB, so 06, 12, 16 are past → should return 19:00 today
    const nowWib = new Date("2026-11-22T10:00:00Z"); // 17:00 WIB
    const occupied = new Set<string>();
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-22@19:00");
  });

  it("skips occupied slots and returns next free", () => {
    // Now = 11:00 WIB, 12:00 occupied → next is 16:00
    const nowWib = new Date("2026-11-22T04:00:00Z"); // 11:00 WIB
    const occupied = new Set(["2026-11-22@12:00"]);
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-22@16:00");
  });

  it("skips slot within minLeadMin window", () => {
    // Now = 11:50 WIB, 12:00 is only 10 min away (< 15 min) → next is 16:00
    const nowWib = new Date("2026-11-22T04:50:00Z"); // 11:50 WIB
    const occupied = new Set<string>();
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-22@16:00");
  });

  it("wraps to next day when all today slots are past or occupied", () => {
    // Now = 20:00 WIB, all today slots past → first tomorrow = 06:00
    const nowWib = new Date("2026-11-22T13:00:00Z"); // 20:00 WIB
    const occupied = new Set<string>();
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-23@06:00");
    expect(result.candidate.toISOString()).toBe("2026-11-22T23:00:00.000Z"); // 06:00 WIB next day
  });

  it("handles all today slots occupied (all days slots occupied tomorrow too first slot ok)", () => {
    // Now = 11:00, all today slots occupied → tomorrow 06:00
    const nowWib = new Date("2026-11-22T04:00:00Z");
    const occupied = new Set(["2026-11-22@12:00", "2026-11-22@16:00", "2026-11-22@19:00"]);
    const result = nextFreeSlot(nowWib, slotTimes, occupied, minLeadMin);
    expect(result.key).toBe("2026-11-23@06:00");
  });
});
