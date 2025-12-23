import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseDateString,
  parseDateRange,
  getDaysBackRange,
  getToday,
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

    it('should parse "last week"', () => {
      // Last week starts on Monday
      expect(parseDateString('last week')).toBe('2024-12-02');
    });

    it('should parse "last month"', () => {
      expect(parseDateString('last month')).toBe('2024-11-01');
    });

    it('should throw for invalid date strings', () => {
      expect(() => parseDateString('invalid')).toThrow('Unable to parse date');
      expect(() => parseDateString('next week')).toThrow('Unable to parse date');
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
      expect(range.start).toBe('2024-09-15');
      expect(range.end).toBe('2024-12-15');
    });

    it('should throw for invalid range strings', () => {
      expect(() => parseDateRange('invalid')).toThrow('Unable to parse date range');
    });
  });

  describe('getDaysBackRange', () => {
    it('should return correct range for given days', () => {
      const range = getDaysBackRange(7);
      expect(range.start).toBe('2024-12-08');
      expect(range.end).toBe('2024-12-15');
    });

    it('should handle 0 days', () => {
      const range = getDaysBackRange(0);
      expect(range.start).toBe('2024-12-15');
      expect(range.end).toBe('2024-12-15');
    });

    it('should handle 30 days', () => {
      const range = getDaysBackRange(30);
      expect(range.start).toBe('2024-11-15');
      expect(range.end).toBe('2024-12-15');
    });
  });

  describe('getToday', () => {
    it('should return today\'s date in ISO format', () => {
      expect(getToday()).toBe('2024-12-15');
    });
  });

  describe('getStartOfDay', () => {
    it('should return start of day as ISO datetime', () => {
      const result = getStartOfDay('2024-12-15');
      expect(result).toMatch(/^2024-12-15T00:00:00/);
    });
  });

  describe('getEndOfDay', () => {
    it('should return end of day as ISO datetime', () => {
      const result = getEndOfDay('2024-12-15');
      expect(result).toMatch(/^2024-12-15T23:59:59/);
    });
  });
});
