import { describe, it, expect } from "vitest";
import { planTargets } from "../src/planner";

describe("planTargets", () => {
  // dueAt = 2026-11-23T23:00:00Z (Senin 23 Nov 06:00 WIB)
  const dueAt = new Date("2026-11-23T23:00:00Z");
  // now = 2026-11-22T04:00:00Z (Minggu 22 Nov 11:00 WIB, > 2 hari sebelum due)
  const nowEarly = new Date("2026-11-22T04:00:00Z");

  it("YouTube: dispatch_at = now (immediately after save)", () => {
    const targets = planTargets(dueAt, nowEarly);
    const yt = targets.find((t) => t.platform === "youtube");
    expect(yt).toBeDefined();
    expect(yt!.dispatch_at.toISOString()).toBe(nowEarly.toISOString());
  });

  it("Instagram: dispatch_at = dueAt - 10 minutes", () => {
    const targets = planTargets(dueAt, nowEarly);
    const ig = targets.find((t) => t.platform === "instagram");
    expect(ig).toBeDefined();
    // 23:00:00Z - 10m = 22:50:00Z
    expect(ig!.dispatch_at.toISOString()).toBe("2026-11-23T22:50:00.000Z");
  });

  it("TikTok: dispatch_at = now when due_at is > windowDays away", () => {
    // dueAt - now > 2 days → TikTok dispatch starts now (will be gated by rolling window)
    const targets = planTargets(dueAt, nowEarly, { tiktokWindowDays: 2 });
    const tt = targets.find((t) => t.platform === "tiktok");
    expect(tt).toBeDefined();
    expect(tt!.dispatch_at.toISOString()).toBe(nowEarly.toISOString());
  });

  it("returns all 3 platforms", () => {
    const targets = planTargets(dueAt, nowEarly);
    const platforms = targets.map((t) => t.platform).sort();
    expect(platforms).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("filters to only selected platforms and deduplicates", () => {
    const targets = planTargets(dueAt, nowEarly, {
      platforms: ["youtube", "instagram", "youtube"],
    });
    const platforms = targets.map((t) => t.platform);
    expect(platforms).toEqual(["youtube", "instagram"]);
  });
});
