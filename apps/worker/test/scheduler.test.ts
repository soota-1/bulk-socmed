import { describe, it, expect } from "vitest";
import { isTargetMissed } from "../src/scheduler";

describe("scheduler — missed policy evaluation", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const graceMinutes = 120; // 2 hours

  it("returns false if dueAt is in the future", () => {
    const futureDue = new Date("2026-11-22T12:30:00Z");
    expect(isTargetMissed(futureDue, now, graceMinutes)).toBe(false);
  });

  it("returns false if dueAt is in the past but within grace period", () => {
    // 30 minutes in the past <= 120 minutes grace
    const pastWithinGrace = new Date("2026-11-22T11:30:00Z");
    expect(isTargetMissed(pastWithinGrace, now, graceMinutes)).toBe(false);
  });

  it("returns false if dueAt is exactly at grace period boundary", () => {
    // Exactly 120 minutes in the past
    const boundaryDue = new Date("2026-11-22T10:00:00Z");
    expect(isTargetMissed(boundaryDue, now, graceMinutes)).toBe(false);
  });

  it("returns true if dueAt exceeds grace period", () => {
    // 121 minutes in the past > 120 minutes grace
    const pastExceeded = new Date("2026-11-22T09:59:00Z");
    expect(isTargetMissed(pastExceeded, now, graceMinutes)).toBe(true);
  });
});
