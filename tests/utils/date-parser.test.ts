import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseDateString,
  parseDateStringInTimezone,
  parseDateRange,
  getDaysBackRange,
  getToday,
  getTodayInTimezone,
  getCurrentDateTimeInTimezone,
  getStartOfDay,
  getEndOfDay,
} from '../../src/utils/date-parser.js';

describe('date-parser', () => {
  // Mock the current date for consistent testing
  const mockDate = new Date('2024-12-15T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parseDateString', () => {
    it('should parse ISO date strings', () => {
      expect(parseDateString('2024-12-15')).toBe('2024-12-15');
      expect(parseDateString('2024-01-01')).toBe('2024-01-01');
    });

    it('should parse "today"', () => {
      expect(parseDateString('today')).toBe('2024-12-15');
      expect(parseDateString('Today')).toBe('2024-12-15');
      expect(parseDateString('TODAY')).toBe('2024-12-15');
    });

    it('should parse "yesterday"', () => {
      expect(parseDateString('yesterday')).toBe('2024-12-14');
      expect(parseDateString('Yesterday')).toBe('2024-12-14');
    });

    it('should parse "tomorrow"', () => {
      expect(parseDateString('tomorrow')).toBe('2024-12-16');
      expect(parseDateString('Tomorrow')).toBe('2024-12-16');
    });

    it('should parse "X days ago"', () => {
      expect(parseDateString('1 day ago')).toBe('2024-12-14');
      expect(parseDateString('3 days ago')).toBe('2024-12-12');
      expect(parseDateString('7 days ago')).toBe('2024-12-08');
      expect(parseDateString('30 days ago')).toBe('2024-11-15');
    });

    it('should parse "X weeks ago"', () => {
      expect(parseDateString('1 week ago')).toBe('2024-12-08');
      expect(parseDateString('2 weeks ago')).toBe('2024-12-01');
    });

    it('should parse "X months ago"', () => {
      expect(parseDateString('1 month ago')).toBe('2024-11-15');
      expect(parseDateString('3 months ago')).toBe('2024-09-15');
    });

    it('should parse "last week" (chrono returns a date in last week)', () => {
      const result = parseDateString('last week');
      // chrono-node returns a date in the previous week
      expect(result).toMatch(/^2024-12-0[1-8]$/);
    });

    it('should parse "last month" (chrono returns a date in last month)', () => {
      const result = parseDateString('last month');
      // chrono-node returns a date in November
      expect(result).toMatch(/^2024-11-\d{2}$/);
    });

    // New chrono-node capabilities
    it('should parse "next week"', () => {
      const result = parseDateString('next week');
      // chrono-node returns a date in the next week (Dec 16-22)
      expect(result).toMatch(/^2024-12-(1[6-9]|2[0-2])$/);
    });

    it('should parse day names like "next wednesday"', () => {
      // Dec 15, 2024 is a Sunday. Next Wednesday is Dec 18
      expect(parseDateString('next wednesday')).toBe('2024-12-18');
    });

    it('should parse day names like "last friday"', () => {
      // Dec 15, 2024 is a Sunday. Last Friday was Dec 13
      expect(parseDateString('last friday')).toBe('2024-12-13');
    });

    it('should parse "in X days"', () => {
      expect(parseDateString('in 3 days')).toBe('2024-12-18');
      expect(parseDateString('in 1 week')).toBe('2024-12-22');
    });

    it('should parse natural date formats', () => {
      expect(parseDateString('December 25')).toBe('2024-12-25');
      expect(parseDateString('Dec 25')).toBe('2024-12-25');
      expect(parseDateString('January 1, 2025')).toBe('2025-01-01');
    });

    it('should throw for invalid date strings', () => {
      expect(() => parseDateString('invalid')).toThrow('Unable to parse date');
      expect(() => parseDateString('not a date')).toThrow('Unable to parse date');
    });
  });

  describe('parseDateRange', () => {
    it('should parse "today"', () => {
      const range = parseDateRange('today');
      expect(range.start).toBe('2024-12-15');
      expect(range.end).toBe('2024-12-15');
    });

    it('should parse "this week"', () => {
      const range = parseDateRange('this week');
      expect(range.start).toBe('2024-12-09'); // Monday
      expect(range.end).toBe('2024-12-15'); // Sunday
    });

    it('should parse "last week"', () => {
      const range = parseDateRange('last week');
      expect(range.start).toBe('2024-12-02');
      expect(range.end).toBe('2024-12-08');
    });

    it('should parse "this month"', () => {
      const range = parseDateRange('this month');
      expect(range.start).toBe('2024-12-01');
      expect(range.end).toBe('2024-12-31');
    });

    it('should parse "last month"', () => {
      const range = parseDateRange('last month');
      expect(range.start).toBe('2024-11-01');
      expect(range.end).toBe('2024-11-30');
    });

    it('should parse "last X days"', () => {
      const range = parseDateRange('last 7 days');
      expect(range.start).toBe('2024-12-08');
      expect(range.end).toBe('2024-12-15');
    });

    it('should parse "last X weeks"', () => {
      const range = parseDateRange('last 2 weeks');
      expect(range.start).toBe('2024-12-01');
      expect(range.end).toBe('2024-12-15');
    });

    it('should parse "last X months"', () => {
      const range = parseDateRange('last 3 months');
      // 3 months = 90 days, so start = Dec 15 - 90 = Sep 16
      expect(range.start).toBe('2024-09-16');
      expect(range.end).toBe('2024-12-15');
    });

    it('should throw for invalid range strings', () => {
      expect(() => parseDateRange('invalid')).toThrow('Unable to parse date range');
    });
  });

  describe('getDaysBackRange', () => {
    it('should return 7 days including today for days=7', () => {
      const range = getDaysBackRange(7);
      // 7 days = today (12-15) + 6 previous days, so start = 12-09
      expect(range.start).toBe('2024-12-09');
      expect(range.end).toBe('2024-12-15');
    });

    it('should return just today for days=1', () => {
      const range = getDaysBackRange(1);
      expect(range.start).toBe('2024-12-15');
      expect(range.end).toBe('2024-12-15');
    });

    it('should handle 0 days as today only', () => {
      const range = getDaysBackRange(0);
      expect(range.start).toBe('2024-12-15');
      expect(range.end).toBe('2024-12-15');
    });

    it('should handle 30 days', () => {
      const range = getDaysBackRange(30);
      // 30 days = today + 29 previous days, so start = 11-16
      expect(range.start).toBe('2024-11-16');
      expect(range.end).toBe('2024-12-15');
    });
  });

  describe('getToday', () => {
    it('should return today\'s date in ISO format', () => {
      expect(getToday()).toBe('2024-12-15');
    });
  });

  describe('getTodayInTimezone', () => {
    it('should return today\'s date in the specified timezone', () => {
      // At 12:00 UTC on Dec 15, it's still Dec 15 in UTC
      expect(getTodayInTimezone('UTC')).toBe('2024-12-15');
    });

    it('should handle timezone where it is a different date', () => {
      // At 12:00 UTC on Dec 15, in a timezone like Pacific/Auckland (+13), it's already late Dec 15
      // In a timezone like Pacific/Honolulu (-10), it's still Dec 15 02:00
      expect(getTodayInTimezone('Pacific/Honolulu')).toBe('2024-12-15');
    });

    it('should return previous day in western timezones when UTC is early morning', () => {
      // Set time to 02:00 UTC on Dec 15
      vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
      // At 02:00 UTC, in America/Denver (UTC-7), it's 19:00 on Dec 14
      expect(getTodayInTimezone('America/Denver')).toBe('2024-12-14');
    });
  });

  describe('getCurrentDateTimeInTimezone', () => {
    it('should return ISO 8601 datetime with timezone offset', () => {
      // At 12:00:00 UTC on Dec 15
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('UTC');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(result).toBe('2024-12-15T12:00:00+00:00');
    });

    it('should show correct time for America/New_York (UTC-5)', () => {
      // At 12:00:00 UTC on Dec 15, it's 07:00:00 in New York (EST, UTC-5)
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('America/New_York');
      expect(result).toBe('2024-12-15T07:00:00-05:00');
    });

    it('should show correct time for America/Los_Angeles (UTC-8)', () => {
      // At 12:00:00 UTC on Dec 15, it's 04:00:00 in LA (PST, UTC-8)
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('America/Los_Angeles');
      expect(result).toBe('2024-12-15T04:00:00-08:00');
    });

    it('should show correct time for Europe/London (UTC+0 in winter)', () => {
      // At 12:00:00 UTC on Dec 15, it's 12:00:00 in London (GMT)
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('Europe/London');
      expect(result).toBe('2024-12-15T12:00:00+00:00');
    });

    it('should show correct time for Europe/Paris (UTC+1 in winter)', () => {
      // At 12:00:00 UTC on Dec 15, it's 13:00:00 in Paris (CET, UTC+1)
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('Europe/Paris');
      expect(result).toBe('2024-12-15T13:00:00+01:00');
    });

    it('should handle date boundary crossing to next day', () => {
      // At 23:00:00 UTC on Dec 15, it's 08:00:00 on Dec 16 in Asia/Tokyo (JST, UTC+9)
      vi.setSystemTime(new Date('2024-12-15T23:00:00Z'));
      const result = getCurrentDateTimeInTimezone('Asia/Tokyo');
      expect(result).toBe('2024-12-16T08:00:00+09:00');
    });

    it('should handle date boundary crossing to previous day', () => {
      // At 02:00:00 UTC on Dec 15, it's 19:00:00 on Dec 14 in America/Denver (MST, UTC-7)
      vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
      const result = getCurrentDateTimeInTimezone('America/Denver');
      expect(result).toBe('2024-12-14T19:00:00-07:00');
    });

    it('should handle half-hour offset timezones', () => {
      // At 12:00:00 UTC on Dec 15, it's 17:30:00 in India (IST, UTC+5:30)
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));
      const result = getCurrentDateTimeInTimezone('Asia/Kolkata');
      expect(result).toBe('2024-12-15T17:30:00+05:30');
    });
  });

  describe('parseDateStringInTimezone', () => {
    it('should parse ISO date strings regardless of timezone', () => {
      expect(parseDateStringInTimezone('2024-12-15', 'America/New_York')).toBe('2024-12-15');
      expect(parseDateStringInTimezone('2024-01-01', 'Europe/London')).toBe('2024-01-01');
    });

    it('should parse "today" using the specified timezone', () => {
      expect(parseDateStringInTimezone('today', 'UTC')).toBe('2024-12-15');
    });

    it('should parse "yesterday" using the specified timezone', () => {
      expect(parseDateStringInTimezone('yesterday', 'UTC')).toBe('2024-12-14');
    });

    it('should parse relative dates using the specified timezone', () => {
      // At 12:00 UTC on Dec 15
      expect(parseDateStringInTimezone('today', 'UTC')).toBe('2024-12-15');
      expect(parseDateStringInTimezone('3 days ago', 'UTC')).toBe('2024-12-12');
    });

    it('should handle timezone differences for relative dates', () => {
      // Set time to 02:00 UTC on Dec 15
      vi.setSystemTime(new Date('2024-12-15T02:00:00Z'));
      // In America/Denver (UTC-7), it's 19:00 on Dec 14
      expect(parseDateStringInTimezone('today', 'America/Denver')).toBe('2024-12-14');
      expect(parseDateStringInTimezone('yesterday', 'America/Denver')).toBe('2024-12-13');
    });

    it('should parse day names with timezone context', () => {
      // Dec 15, 2024 is a Sunday
      expect(parseDateStringInTimezone('next wednesday', 'UTC')).toBe('2024-12-18');
    });
  });

  describe('getStartOfDay', () => {
    it('should return start of day as ISO datetime', () => {
      const result = getStartOfDay('2024-12-15');
      // Result is in UTC, so just verify it's a valid ISO string
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Verify the parsed date represents midnight local time
      const parsed = new Date(result);
      expect(parsed.getHours()).toBe(0);
      expect(parsed.getMinutes()).toBe(0);
      expect(parsed.getSeconds()).toBe(0);
    });
  });

  describe('getEndOfDay', () => {
    it('should return end of day as ISO datetime', () => {
      const result = getEndOfDay('2024-12-15');
      // Result is in UTC, so just verify it's a valid ISO string
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Verify the parsed date represents end of day local time
      const parsed = new Date(result);
      expect(parsed.getHours()).toBe(23);
      expect(parsed.getMinutes()).toBe(59);
      expect(parsed.getSeconds()).toBe(59);
    });
  });
});
