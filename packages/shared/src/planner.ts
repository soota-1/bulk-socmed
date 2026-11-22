import { addMinutes, subDays } from "date-fns";
import {
  DEFAULT_INSTAGRAM_PREPARE_LEAD_MINUTES,
  DEFAULT_TIKTOK_WINDOW_DAYS,
} from "./constants";
import type { Platform, PlannedTarget, PlannerOptions } from "./types";

/**
 * Calculate planned dispatch times for each platform target.
 *
 * Rules:
 * - YouTube: dispatch immediately (now), upload in advance and schedule via publishAt
 * - Instagram: dispatch at dueAt - instagramPrepareLeadMinutes (container preparation)
 * - TikTok: dispatch now (rolling window gate is enforced at worker-time, not plan-time)
 */
export function planTargets(
  dueAt: Date,
  now: Date,
  options?: PlannerOptions
): PlannedTarget[] {
  const instagramLead =
    options?.instagramPrepareLeadMinutes ?? DEFAULT_INSTAGRAM_PREPARE_LEAD_MINUTES;

  const platforms: Platform[] = ["youtube", "instagram", "tiktok"];

  return platforms.map((platform): PlannedTarget => {
    let dispatch_at: Date;

    switch (platform) {
      case "youtube":
        // Upload immediately so YouTube has time to process before dueAt
        dispatch_at = new Date(now);
        break;

      case "instagram":
        // Prepare container instagramLead minutes before dueAt
        dispatch_at = addMinutes(dueAt, -instagramLead);
        break;

      case "tiktok":
        // Worker will gate dispatch via rolling window at claim time.
        // Plan dispatch_at = now so it enters the queue immediately.
        dispatch_at = new Date(now);
        break;
    }

    return { platform, dispatch_at };
  });
}

/**
 * Check whether a TikTok post's dueAt is within the rolling dispatch window.
 * The worker calls this before calling Buffer API.
 */
export function isInTiktokWindow(
  dueAt: Date,
  now: Date,
  windowDays?: number
): boolean {
  const days = windowDays ?? DEFAULT_TIKTOK_WINDOW_DAYS;
  const windowEnd = subDays(dueAt, 0); // dueAt itself is the deadline
  const windowStart = subDays(windowEnd, days);
  return now >= windowStart;
}
