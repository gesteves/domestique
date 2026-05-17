import * as chrono from 'chrono-node';
import { formatInTimeZone } from 'date-fns-tz';
import { DateParseError } from '../errors/index.js';

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 * Wraps date-fns-tz so callers don't depend on a specific format string or locale.
 */
export function formatYMDInTimezone(date: Date | number, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

/** Get today's date as YYYY-MM-DD in the given IANA timezone. */
export function getTodayInTimezone(timezone: string): string {
  return formatYMDInTimezone(new Date(), timezone);
}

/**
 * Strict YYYY-MM-DD parse that also rejects impossible calendar dates
 * (e.g. 2026-02-30). Returns the trimmed date string when valid, else null.
 * Does not resolve relative dates ("today") — callers that need a default
 * should substitute one explicitly.
 */
export function parseYMD(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Add a (possibly negative) number of days to a YYYY-MM-DD string.
 * Operates on UTC components only, so the result is independent of the JS runtime's timezone.
 */
export function addDaysToYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromUTC(date);
}

/**
 * Add (or subtract) a number of calendar months to a YYYY-MM-DD string.
 * Day overflow is handled by Date.setUTCMonth (e.g. Jan 31 + 1 month -> Mar 3).
 */
export function addMonthsToYMD(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + months);
  return ymdFromUTC(date);
}

/**
 * Convert a UTC timestamp (or `undefined` to mean "now") into a YYYY-MM-DD
 * using a fixed offset like Whoop's `timezone_offset` ("Z", "-05:00", "+0200").
 *
 * Unlike `formatYMDInTimezone`, this takes a raw numeric offset string rather
 * than an IANA zone name — handy for sources like Whoop that record the
 * offset that applied at the moment of the event, regardless of the athlete's
 * current location.
 */
export function formatYMDFromOffset(
  timestamp: string | undefined,
  offset: string,
  now: Date = new Date()
): string {
  const offsetMs = parseFixedOffsetMs(offset);
  const baseMs = timestamp ? new Date(timestamp).getTime() : now.getTime();
  return new Date(baseMs + offsetMs).toISOString().slice(0, 10);
}

function parseFixedOffsetMs(offset: string): number {
  if (offset === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) {
    throw new Error(`Unrecognized fixed timezone offset: ${offset}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

/**
 * Whether a UTC timestamp falls within [startYMD, endYMD] (inclusive)
 * when interpreted in the given timezone.
 */
export function isTimestampInLocalDateRange(
  timestamp: string | number | Date,
  startYMD: string,
  endYMD: string,
  timezone: string
): boolean {
  const localYMD = formatYMDInTimezone(new Date(timestamp), timezone);
  return localYMD >= startYMD && localYMD <= endYMD;
}

/**
 * Parse a natural language date string into YYYY-MM-DD,
 * using the given IANA timezone for relative date calculations.
 *
 * Order of attempts:
 * 1. ISO YYYY-MM-DD pass-through.
 * 2. Common relative offsets (today/yesterday/tomorrow/N days|weeks|months ago/in N ...) —
 *    computed against today-in-timezone using UTC arithmetic.
 * 3. chrono-node fallback for absolute or named dates ("December 25", "next wednesday").
 */
export function parseDateStringInTimezone(
  input: string,
  timezone: string,
  parameterName: string = 'date'
): string {
  const normalized = input.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const todayYMD = getTodayInTimezone(timezone);

  const offset = tryParseOffset(normalized, todayYMD);
  if (offset !== null) return offset;

  // chrono fallback: reference at noon UTC of today-in-timezone keeps the
  // calendar day stable when the JS runtime is UTC (CI/Docker default).
  const [y, m, d] = todayYMD.split('-').map(Number);
  const refDate = new Date(Date.UTC(y, m - 1, d, 12));
  const result = chrono.parseDate(normalized, refDate);
  if (result) {
    return formatYMDInTimezone(result, timezone);
  }

  throw new DateParseError(input, parameterName);
}

/**
 * Parse oldest/newest date parameters into a {startDate, endDate} range,
 * using the given timezone for relative date parsing.
 * If newest is omitted, defaults to today in the given timezone.
 */
export function parseDateRangeInTimezone(
  oldest: string,
  newest: string | undefined,
  timezone: string
): { startDate: string; endDate: string } {
  const startDate = parseDateStringInTimezone(oldest, timezone, 'oldest');
  const endDate = newest
    ? parseDateStringInTimezone(newest, timezone, 'newest')
    : getTodayInTimezone(timezone);
  return { startDate, endDate };
}

function ymdFromUTC(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function tryParseOffset(input: string, todayYMD: string): string | null {
  const s = input.toLowerCase().trim();
  if (s === 'today') return todayYMD;
  if (s === 'yesterday') return addDaysToYMD(todayYMD, -1);
  if (s === 'tomorrow') return addDaysToYMD(todayYMD, 1);

  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)\s+days?\s+ago$/))) return addDaysToYMD(todayYMD, -parseInt(m[1], 10));
  if ((m = s.match(/^in\s+(\d+)\s+days?$/))) return addDaysToYMD(todayYMD, parseInt(m[1], 10));
  if ((m = s.match(/^(\d+)\s+weeks?\s+ago$/))) return addDaysToYMD(todayYMD, -parseInt(m[1], 10) * 7);
  if ((m = s.match(/^in\s+(\d+)\s+weeks?$/))) return addDaysToYMD(todayYMD, parseInt(m[1], 10) * 7);
  if ((m = s.match(/^(\d+)\s+months?\s+ago$/))) return addMonthsToYMD(todayYMD, -parseInt(m[1], 10));
  if ((m = s.match(/^in\s+(\d+)\s+months?$/))) return addMonthsToYMD(todayYMD, parseInt(m[1], 10));
  return null;
}
