import { addDays, addMinutes, format, setHours, setMinutes, setSeconds, setMilliseconds, startOfDay } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { TIMEZONE_WIB } from "./constants.js";
import type { NextFreeSlotResult } from "./types.js";

/**
 * Parse "HH:MM" string into { hours, minutes }.
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }
  return { hours: h, minutes: m };
}

/**
 * Format a UTC Date as "YYYY-MM-DD" in WIB timezone.
 */
export function formatDateWib(utcDate: Date): string {
  const wib = toZonedTime(utcDate, TIMEZONE_WIB);
  return format(wib, "yyyy-MM-dd");
}

/**
 * Given a UTC Date representing the start of a WIB day, and a "HH:MM" slot time,
 * return the UTC Date for that slot time in WIB.
 *
 * wibDayStart: a UTC date that, when converted to WIB, falls on the desired WIB date.
 */
function slotUtcDate(wibDayStartUtc: Date, slotTimeStr: string): Date {
  const { hours, minutes } = parseTime(slotTimeStr);
  // Get the WIB date string for this day
  const wibZoned = toZonedTime(wibDayStartUtc, TIMEZONE_WIB);
  const wibDay = startOfDay(wibZoned);
  // Set the slot time in WIB
  let wibSlot = setHours(wibDay, hours);
  wibSlot = setMinutes(wibSlot, minutes);
  wibSlot = setSeconds(wibSlot, 0);
  wibSlot = setMilliseconds(wibSlot, 0);
  // Convert back to UTC
  return fromZonedTime(wibSlot, TIMEZONE_WIB);
}

/**
 * Find the next free slot from the given nowWib moment.
 *
 * @param nowWib - Current time as UTC Date (will be interpreted in WIB context)
 * @param slotTimes - Array of "HH:MM" WIB slot times (sorted or unsorted)
 * @param occupied - Set of slot keys already taken ("YYYY-MM-DD@HH:MM")
 * @param minLeadMin - Minimum minutes from now that a slot must be in the future
 */
export function nextFreeSlot(
  nowWib: Date,
  slotTimes: string[],
  occupied: Set<string>,
  minLeadMin: number
): NextFreeSlotResult {
  const sorted = [...slotTimes].sort();
  const minValidTime = addMinutes(nowWib, minLeadMin);

  // Try days starting from today (WIB) up to 60 days forward
  for (let d = 0; d < 60; d++) {
    // Start of WIB day d days from now
    const wibNow = toZonedTime(nowWib, TIMEZONE_WIB);
    const wibDayZoned = startOfDay(addDays(wibNow, d));
    const wibDayUtc = fromZonedTime(wibDayZoned, TIMEZONE_WIB);

    const dateStr = format(wibDayZoned, "yyyy-MM-dd");

    for (const slotTime of sorted) {
      const candidateUtc = slotUtcDate(wibDayUtc, slotTime);
      const key = `${dateStr}@${slotTime}`;

      if (candidateUtc >= minValidTime && !occupied.has(key)) {
        return { candidate: candidateUtc, key };
      }
    }
  }

  throw new Error("No free slot found within 60 days");
}

/**
 * Build a slot key string for a given UTC date in WIB.
 * Returns "YYYY-MM-DD@HH:MM" using WIB date/time.
 */
export function buildSlotKey(utcDate: Date): string {
  const wib = toZonedTime(utcDate, TIMEZONE_WIB);
  return `${format(wib, "yyyy-MM-dd")}@${format(wib, "HH:mm")}`;
}
