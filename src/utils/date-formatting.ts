/**
 * Date formatting utilities using date-fns-tz for timezone-aware formatting
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Format a date to ISO 8601 with timezone offset.
 * Returns format: YYYY-MM-DDTHH:mm:ss±HH:mm
 *
 * @param date - Date object, ISO string, or timestamp
 * @param timezone - IANA timezone (e.g., 'America/New_York', 'Europe/London')
 * @returns ISO 8601 string with timezone offset
 *
 * @example
 * formatToISO8601WithTimezone('2024-12-29T10:30:00Z', 'America/New_York')
 * // Returns: '2024-12-29T05:30:00-05:00'
 */
export function formatToISO8601WithTimezone(date: Date | string | number, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Get the current time in ISO 8601 format with timezone offset.
 * Returns format: YYYY-MM-DDTHH:mm:ss±HH:mm
 *
 * @param timezone - IANA timezone (e.g., 'America/New_York', 'Europe/London')
 * @returns Current time as ISO 8601 string with timezone offset
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  return formatToISO8601WithTimezone(new Date(), timezone);
}

/**
 * Convert a local datetime string (without timezone) to ISO 8601 with timezone offset.
 * Assumes the input string is already in the specified timezone.
 *
 * @param localDateTimeString - Local datetime string (e.g., '2024-12-29T14:30:00')
 * @param timezone - IANA timezone the string is in
 * @returns ISO 8601 string with timezone offset
 *
 * @example
 * localStringToISO8601WithTimezone('2024-12-29T14:30:00', 'America/New_York')
 * // Returns: '2024-12-29T14:30:00-05:00'
 */
export function localStringToISO8601WithTimezone(localDateTimeString: string, timezone: string): string {
  // fromZonedTime interprets the input as local time in the specified timezone
  // and returns the equivalent UTC Date object
  const utcDate = fromZonedTime(localDateTimeString, timezone);
  // Then format that UTC time back in the target timezone with offset
  return formatToISO8601WithTimezone(utcDate, timezone);
}

/**
 * Format a UTC/ISO datetime to a human-readable string in the specified timezone.
 * Returns format: "Sunday, December 15, 2024 at 5:30 AM EST"
 *
 * @param date - Date object, ISO string, or timestamp
 * @param timezone - IANA timezone (e.g., 'America/New_York', 'Europe/London')
 * @returns Human-readable datetime string with timezone abbreviation
 *
 * @example
 * formatDateTimeHumanReadable('2024-12-15T10:30:00Z', 'America/New_York')
 * // Returns: 'Sunday, December 15, 2024 at 5:30 AM EST'
 */
export function formatDateTimeHumanReadable(date: Date | string | number, timezone: string): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  return formatter.format(d);
}

/**
 * Detect a date-only sentinel — a datetime that lands on midnight in the
 * target timezone. Sources like Intervals.icu use `T00:00:00` to mean "no
 * time specified for this day"; we render those as a date alone.
 *
 * For naive datetimes (no offset, no Z) we trust the literal hours; the
 * caller has already declared the string is in `timezone`. For datetimes
 * with `Z` or an explicit offset we compare against the local clock — so
 * `2026-04-29T00:00:00Z` viewed in `America/Denver` correctly resolves to
 * 6:00 PM the prior day and is NOT treated as a date-only sentinel.
 */
function isMidnightInTimezone(isoDateTimeString: string, timezone: string): boolean {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(isoDateTimeString);

  if (!hasOffset) {
    const timeMatch = isoDateTimeString.match(/T(\d{2}):(\d{2}):?(\d{2})?/);
    if (!timeMatch) return false;
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = parseInt(timeMatch[3] || '0', 10);
    return hours === 0 && minutes === 0 && seconds === 0;
  }

  // Aware datetime — see what time it actually is in the target tz.
  const date = new Date(isoDateTimeString);
  if (Number.isNaN(date.getTime())) return false;
  return formatInTimeZone(date, timezone, 'HH:mm:ss') === '00:00:00';
}

/**
 * Convert a local datetime string (without timezone) to a human-readable string.
 * Assumes the input string is already in the specified timezone.
 * Returns format: "Sunday, December 15, 2024 at 5:30 AM EST"
 *
 * For midnight times (00:00:00), returns date-only format: "Sunday, December 15, 2024"
 *
 * @param localDateTimeString - Local datetime string (e.g., '2024-12-29T14:30:00')
 * @param timezone - IANA timezone the string is in
 * @returns Human-readable datetime string
 *
 * @example
 * localStringToHumanReadable('2024-12-29T14:30:00', 'America/New_York')
 * // Returns: 'Sunday, December 29, 2024 at 2:30 PM EST'
 *
 * localStringToHumanReadable('2024-12-29T00:00:00', 'America/New_York')
 * // Returns: 'Sunday, December 29, 2024'
 */
export function localStringToHumanReadable(localDateTimeString: string, timezone: string): string {
  if (isMidnightInTimezone(localDateTimeString, timezone)) {
    return formatDateHumanReadable(localDateTimeString.split('T')[0], timezone);
  }

  const utcDate = fromZonedTime(localDateTimeString, timezone);
  return formatDateTimeHumanReadable(utcDate, timezone);
}

/**
 * Format a date-only string (YYYY-MM-DD) to a human-readable string.
 * Returns format: "Sunday, December 15, 2024"
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timezone - IANA timezone for determining the day of the week
 * @returns Human-readable date string
 *
 * @example
 * formatDateHumanReadable('2024-12-15', 'America/New_York')
 * // Returns: 'Sunday, December 15, 2024'
 */
export function formatDateHumanReadable(dateStr: string, timezone: string): string {
  // Interpret the YYYY-MM-DD as noon in the target timezone to avoid DST boundary issues
  const utcDate = fromZonedTime(`${dateStr}T12:00:00`, timezone);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return formatter.format(utcDate);
}

// ISO date pattern: YYYY-MM-DD (exactly 10 chars, not followed by T)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ISO datetime pattern: YYYY-MM-DDTHH:mm:ss with optional timezone offset or Z
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Fields whose datetime values are always concrete interval boundaries — the
// midnight-as-date-only heuristic must not strip the time on these. Applies
// to the hourly-forecast window edges, where the last hour of a day legitimately
// ends at midnight and the first hour legitimately starts at midnight.
const ALWAYS_FULL_DATETIME_FIELDS = new Set(['forecast_start', 'forecast_end']);

/**
 * Recursively format all date/datetime string values in a response object to human-readable strings.
 * Detects dates by value pattern rather than field name:
 * - ISO date strings (YYYY-MM-DD) → "Sunday, December 15, 2024"
 * - ISO datetime strings (YYYY-MM-DDTHH:mm:ss...) → "Sunday, December 15, 2024 at 5:30 AM EST"
 *   - Midnight datetimes → "Sunday, December 15, 2024" (time omitted)
 *
 * Non-ISO string values are left unchanged.
 *
 * @param data - The response data to format
 * @param timezone - IANA timezone for formatting
 * @returns A new object with all date values formatted
 */
export function formatResponseDates<T>(data: T, timezone: string): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => formatResponseDates(item, timezone)) as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (ISO_DATE_PATTERN.test(value)) {
        result[key] = formatDateHumanReadable(value, timezone);
      } else if (ISO_DATETIME_PATTERN.test(value)) {
        if (!ALWAYS_FULL_DATETIME_FIELDS.has(key) && isMidnightInTimezone(value, timezone)) {
          // For naive midnight strings, the date portion is already correct.
          // For aware datetimes that happen to be midnight in the target tz,
          // pull the local date out of the converted value rather than the
          // raw string (which may be on a different UTC day).
          const localDate = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
            ? formatInTimeZone(new Date(value), timezone, 'yyyy-MM-dd')
            : value.split('T')[0];
          result[key] = formatDateHumanReadable(localDate, timezone);
        } else {
          result[key] = formatDateTimeHumanReadable(value, timezone);
        }
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = formatResponseDates(value, timezone);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
