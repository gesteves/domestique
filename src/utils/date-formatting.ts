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
