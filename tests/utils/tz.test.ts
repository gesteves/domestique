import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatYMDInTimezone,
  getTodayInTimezone,
  addDaysToYMD,
  addMonthsToYMD,
  isTimestampInLocalDateRange,
  parseDateStringInTimezone,
  parseDateRangeInTimezone,
} from '../../src/utils/tz.js';
import { DateParseError } from '../../src/errors/index.js';

const mockDate = new Date('2024-12-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(mockDate);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatYMDInTimezone', () => {
  it('formats a UTC timestamp as YYYY-MM-DD in UTC', () => {
    expect(formatYMDInTimezone(new Date('2024-12-15T12:00:00Z'), 'UTC')).toBe('2024-12-15');
  });

  it('shifts to previous day in western timezones near midnight UTC', () => {
    // 02:00 UTC on Dec 15 is 19:00 on Dec 14 in America/Denver (UTC-7)
    expect(formatYMDInTimezone(new Date('2024-12-15T02:00:00Z'), 'America/Denver')).toBe('2024-12-14');
  });

  it('shifts to next day in eastern timezones near midnight UTC', () => {
    // 23:00 UTC on Dec 14 is 12:00 on Dec 15 in Pacific/Auckland (UTC+13 with DST)
    expect(formatYMDInTimezone(new Date('2024-12-14T23:00:00Z'), 'Pacific/Auckland')).toBe('2024-12-15');
  });

  it('handles half-hour offsets (Asia/Kolkata, UTC+5:30)', () => {
    // 18:00 UTC on Dec 14 is 23:30 on Dec 14 in Kolkata
    expect(formatYMDInTimezone(new Date('2024-12-14T18:00:00Z'), 'Asia/Kolkata')).toBe('2024-12-14');
    // 18:30 UTC on Dec 14 is 00:00 on Dec 15 in Kolkata
    expect(formatYMDInTimezone(new Date('2024-12-14T18:30:00Z'), 'Asia/Kolkata')).toBe('2024-12-15');
  });

  it('handles DST transitions (US spring-forward)', () => {
    // March 10 2024 02:00 local in America/New_York skips to 03:00.
    // 06:30 UTC on March 10 is 02:30 EST (still in DST jump zone, displays as 02:30 or 03:30 depending on tz).
    // We just assert the YMD is correct.
    expect(formatYMDInTimezone(new Date('2024-03-10T07:00:00Z'), 'America/New_York')).toBe('2024-03-10');
    expect(formatYMDInTimezone(new Date('2024-03-10T04:00:00Z'), 'America/New_York')).toBe('2024-03-09');
  });
});

describe('getTodayInTimezone', () => {
  it('returns today in UTC', () => {
    expect(getTodayInTimezone('UTC')).toBe('2024-12-15');
  });

  it('returns previous day in western timezones when UTC is early morning', () => {
    vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
    expect(getTodayInTimezone('America/Denver')).toBe('2024-12-14');
  });

  it('returns next day in eastern timezones when UTC is late evening', () => {
    vi.setSystemTime(new Date('2024-12-14T23:00:00Z'));
    expect(getTodayInTimezone('Pacific/Auckland')).toBe('2024-12-15');
  });
});

describe('addDaysToYMD', () => {
  it('adds positive days', () => {
    expect(addDaysToYMD('2024-12-15', 3)).toBe('2024-12-18');
  });

  it('subtracts with negative days', () => {
    expect(addDaysToYMD('2024-12-15', -3)).toBe('2024-12-12');
  });

  it('crosses month boundaries', () => {
    expect(addDaysToYMD('2024-12-30', 5)).toBe('2025-01-04');
    expect(addDaysToYMD('2024-03-01', -1)).toBe('2024-02-29'); // leap year
  });

  it('crosses year boundaries', () => {
    expect(addDaysToYMD('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDaysToYMD('2025-01-01', -1)).toBe('2024-12-31');
  });

  it('returns same date for 0', () => {
    expect(addDaysToYMD('2024-12-15', 0)).toBe('2024-12-15');
  });
});

describe('addMonthsToYMD', () => {
  it('adds calendar months', () => {
    expect(addMonthsToYMD('2024-12-15', -3)).toBe('2024-09-15');
    expect(addMonthsToYMD('2024-01-15', 1)).toBe('2024-02-15');
  });

  it('crosses year boundaries', () => {
    expect(addMonthsToYMD('2024-11-15', 3)).toBe('2025-02-15');
    expect(addMonthsToYMD('2024-02-15', -3)).toBe('2023-11-15');
  });

  it('overflows day-of-month per setUTCMonth (Jan 31 + 1 month -> Mar 3)', () => {
    expect(addMonthsToYMD('2024-01-31', 1)).toBe('2024-03-02'); // 2024 is leap (Feb has 29 days)
  });
});

describe('isTimestampInLocalDateRange', () => {
  it('returns true when local date falls within the range', () => {
    expect(
      isTimestampInLocalDateRange('2024-12-15T12:00:00Z', '2024-12-14', '2024-12-16', 'UTC')
    ).toBe(true);
  });

  it('returns false when local date is before the range', () => {
    expect(
      isTimestampInLocalDateRange('2024-12-13T12:00:00Z', '2024-12-14', '2024-12-16', 'UTC')
    ).toBe(false);
  });

  it('returns false when local date is after the range', () => {
    expect(
      isTimestampInLocalDateRange('2024-12-17T12:00:00Z', '2024-12-14', '2024-12-16', 'UTC')
    ).toBe(false);
  });

  it('respects the timezone — same UTC moment is in different local dates', () => {
    const ts = '2024-12-15T02:00:00Z'; // Dec 14 19:00 in Denver, Dec 15 02:00 in UTC
    expect(isTimestampInLocalDateRange(ts, '2024-12-15', '2024-12-15', 'UTC')).toBe(true);
    expect(isTimestampInLocalDateRange(ts, '2024-12-15', '2024-12-15', 'America/Denver')).toBe(false);
    expect(isTimestampInLocalDateRange(ts, '2024-12-14', '2024-12-14', 'America/Denver')).toBe(true);
  });
});

describe('parseDateStringInTimezone', () => {
  it('passes ISO dates through unchanged', () => {
    expect(parseDateStringInTimezone('2024-12-15', 'America/New_York')).toBe('2024-12-15');
    expect(parseDateStringInTimezone('2024-01-01', 'Europe/London')).toBe('2024-01-01');
  });

  it('parses "today" / "yesterday" / "tomorrow" in UTC', () => {
    expect(parseDateStringInTimezone('today', 'UTC')).toBe('2024-12-15');
    expect(parseDateStringInTimezone('Today', 'UTC')).toBe('2024-12-15');
    expect(parseDateStringInTimezone('yesterday', 'UTC')).toBe('2024-12-14');
    expect(parseDateStringInTimezone('tomorrow', 'UTC')).toBe('2024-12-16');
  });

  it('parses "X days ago" / "in X days"', () => {
    expect(parseDateStringInTimezone('1 day ago', 'UTC')).toBe('2024-12-14');
    expect(parseDateStringInTimezone('30 days ago', 'UTC')).toBe('2024-11-15');
    expect(parseDateStringInTimezone('in 3 days', 'UTC')).toBe('2024-12-18');
  });

  it('parses "X weeks ago" / "in X weeks"', () => {
    expect(parseDateStringInTimezone('1 week ago', 'UTC')).toBe('2024-12-08');
    expect(parseDateStringInTimezone('2 weeks ago', 'UTC')).toBe('2024-12-01');
    expect(parseDateStringInTimezone('in 1 week', 'UTC')).toBe('2024-12-22');
  });

  it('parses "X months ago" / "in X months" using calendar months', () => {
    expect(parseDateStringInTimezone('1 month ago', 'UTC')).toBe('2024-11-15');
    expect(parseDateStringInTimezone('3 months ago', 'UTC')).toBe('2024-09-15');
  });

  it('respects timezone for relative dates', () => {
    vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
    // Denver clock reads Dec 14 19:00, so "today" in Denver is Dec 14
    expect(parseDateStringInTimezone('today', 'America/Denver')).toBe('2024-12-14');
    expect(parseDateStringInTimezone('yesterday', 'America/Denver')).toBe('2024-12-13');
  });

  it('falls back to chrono for absolute / named dates', () => {
    // Dec 15 2024 is a Sunday
    expect(parseDateStringInTimezone('next wednesday', 'UTC')).toBe('2024-12-18');
    expect(parseDateStringInTimezone('last friday', 'UTC')).toBe('2024-12-13');
    expect(parseDateStringInTimezone('December 25', 'UTC')).toBe('2024-12-25');
    expect(parseDateStringInTimezone('January 1, 2025', 'UTC')).toBe('2025-01-01');
  });

  it('throws DateParseError for unrecognized input', () => {
    expect(() => parseDateStringInTimezone('not a date', 'UTC')).toThrow(DateParseError);
  });

  it('preserves the parameter name in DateParseError', () => {
    try {
      parseDateStringInTimezone('garbage', 'UTC', 'oldest');
      expect.fail('expected DateParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(DateParseError);
      expect((error as DateParseError).parameterName).toBe('oldest');
      expect((error as DateParseError).input).toBe('garbage');
    }
  });
});

describe('parseDateRangeInTimezone', () => {
  it('returns explicit oldest and newest', () => {
    expect(parseDateRangeInTimezone('2024-12-01', '2024-12-15', 'UTC')).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-15',
    });
  });

  it('defaults endDate to today in the timezone when newest is omitted', () => {
    expect(parseDateRangeInTimezone('2024-12-01', undefined, 'UTC')).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-15',
    });
  });

  it('parses natural-language oldest and newest', () => {
    expect(parseDateRangeInTimezone('yesterday', 'today', 'UTC')).toEqual({
      startDate: '2024-12-14',
      endDate: '2024-12-15',
    });
  });

  it('respects timezone for relative dates', () => {
    vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
    expect(parseDateRangeInTimezone('today', undefined, 'America/Denver')).toEqual({
      startDate: '2024-12-14',
      endDate: '2024-12-14',
    });
  });
});
