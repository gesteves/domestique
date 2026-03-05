import { describe, it, expect } from 'vitest';
import {
  formatDateTimeHumanReadable,
  formatDateHumanReadable,
  localStringToHumanReadable,
  formatResponseDates,
} from '../../src/utils/date-formatting.js';

describe('date-formatting', () => {
  const timezone = 'America/New_York';

  describe('formatDateTimeHumanReadable', () => {
    it('should format an ISO datetime string to human-readable format', () => {
      const result = formatDateTimeHumanReadable('2024-12-15T10:30:00Z', timezone);
      // 10:30 UTC = 5:30 AM EST
      expect(result).toBe('Sunday, December 15, 2024 at 5:30 AM EST');
    });

    it('should format a Date object', () => {
      const date = new Date('2024-12-15T10:30:00Z');
      const result = formatDateTimeHumanReadable(date, timezone);
      expect(result).toBe('Sunday, December 15, 2024 at 5:30 AM EST');
    });

    it('should respect the timezone parameter', () => {
      const result = formatDateTimeHumanReadable('2024-12-15T10:30:00Z', 'Europe/London');
      // 10:30 UTC = 10:30 AM GMT
      expect(result).toBe('Sunday, December 15, 2024 at 10:30 AM GMT');
    });

    it('should handle PM times', () => {
      const result = formatDateTimeHumanReadable('2024-12-15T20:30:00Z', timezone);
      // 20:30 UTC = 3:30 PM EST
      expect(result).toBe('Sunday, December 15, 2024 at 3:30 PM EST');
    });
  });

  describe('formatDateHumanReadable', () => {
    it('should format a YYYY-MM-DD date string', () => {
      const result = formatDateHumanReadable('2024-12-15', timezone);
      expect(result).toBe('Sunday, December 15, 2024');
    });

    it('should handle different days of the week', () => {
      expect(formatDateHumanReadable('2024-12-16', timezone)).toBe('Monday, December 16, 2024');
      expect(formatDateHumanReadable('2024-12-17', timezone)).toBe('Tuesday, December 17, 2024');
    });

    it('should handle different months', () => {
      expect(formatDateHumanReadable('2024-01-01', timezone)).toBe('Monday, January 1, 2024');
      expect(formatDateHumanReadable('2024-06-15', timezone)).toBe('Saturday, June 15, 2024');
    });
  });

  describe('localStringToHumanReadable', () => {
    it('should format a local datetime string with time', () => {
      const result = localStringToHumanReadable('2024-12-15T14:30:00', timezone);
      expect(result).toBe('Sunday, December 15, 2024 at 2:30 PM EST');
    });

    it('should format midnight times as date-only', () => {
      const result = localStringToHumanReadable('2024-12-15T00:00:00', timezone);
      expect(result).toBe('Sunday, December 15, 2024');
    });

    it('should handle times without seconds', () => {
      const result = localStringToHumanReadable('2024-12-15T14:30', timezone);
      // No seconds in input, treated as non-midnight
      expect(result).toContain('December 15, 2024');
    });
  });

  describe('formatResponseDates', () => {
    it('should format date-only fields', () => {
      const data = {
        date: '2024-12-15',
        period_start: '2024-12-01',
        period_end: '2024-12-31',
        other_field: 'not a date',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.date).toBe('Sunday, December 15, 2024');
      expect(result.period_start).toBe('Sunday, December 1, 2024');
      expect(result.period_end).toBe('Tuesday, December 31, 2024');
      expect(result.other_field).toBe('not a date');
    });

    it('should format datetime fields', () => {
      const data = {
        start_time: '2024-12-15T14:30:00-05:00',
        end_time: '2024-12-15T15:30:00-05:00',
        name: 'Test Workout',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.start_time).toBe('Sunday, December 15, 2024 at 2:30 PM EST');
      expect(result.end_time).toBe('Sunday, December 15, 2024 at 3:30 PM EST');
      expect(result.name).toBe('Test Workout');
    });

    it('should format midnight datetime as date-only', () => {
      const data = {
        scheduled_for: '2024-12-15T00:00:00-05:00',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.scheduled_for).toBe('Sunday, December 15, 2024');
    });

    it('should handle nested objects recursively', () => {
      const data = {
        whoop: {
          strain: {
            date: '2024-12-15',
            activities: [
              {
                start_time: '2024-12-15T14:30:00-05:00',
                end_time: '2024-12-15T15:30:00-05:00',
              },
            ],
          },
        },
      };
      const result = formatResponseDates(data, timezone);
      expect(result.whoop.strain.date).toBe('Sunday, December 15, 2024');
      expect(result.whoop.strain.activities[0].start_time).toBe(
        'Sunday, December 15, 2024 at 2:30 PM EST'
      );
    });

    it('should handle arrays', () => {
      const data = [
        { date: '2024-12-15', value: 1 },
        { date: '2024-12-16', value: 2 },
      ];
      const result = formatResponseDates(data, timezone);
      expect(result[0].date).toBe('Sunday, December 15, 2024');
      expect(result[1].date).toBe('Monday, December 16, 2024');
    });

    it('should handle null and undefined values', () => {
      const data = {
        date: null,
        start_time: undefined,
        name: 'test',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.name).toBe('test');
    });

    it('should not modify non-date fields with date-like values', () => {
      const data = {
        description: '2024-12-15',
        name: '2024-12-15T14:30:00',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.description).toBe('2024-12-15');
      expect(result.name).toBe('2024-12-15T14:30:00');
    });

    it('should skip already formatted human-readable strings', () => {
      const data = {
        date: 'Sunday, December 15, 2024',
        start_time: 'Sunday, December 15, 2024 at 2:30 PM EST',
      };
      const result = formatResponseDates(data, timezone);
      // These don't match ISO patterns, so they should be left unchanged
      expect(result.date).toBe('Sunday, December 15, 2024');
      expect(result.start_time).toBe('Sunday, December 15, 2024 at 2:30 PM EST');
    });

    it('should format sleep and nap date fields', () => {
      const data = {
        sleep_start: '2024-12-14T23:00:00-05:00',
        sleep_end: '2024-12-15T07:00:00-05:00',
        nap_start: '2024-12-15T13:00:00-05:00',
        nap_end: '2024-12-15T13:30:00-05:00',
      };
      const result = formatResponseDates(data, timezone);
      expect(result.sleep_start).toBe('Saturday, December 14, 2024 at 11:00 PM EST');
      expect(result.sleep_end).toBe('Sunday, December 15, 2024 at 7:00 AM EST');
      expect(result.nap_start).toBe('Sunday, December 15, 2024 at 1:00 PM EST');
      expect(result.nap_end).toBe('Sunday, December 15, 2024 at 1:30 PM EST');
    });

    it('should format comparison period dates', () => {
      const data = {
        comparison: {
          previous_period_start: '2024-09-01',
          previous_period_end: '2024-11-30',
          previous_activity_count: 10,
        },
      };
      const result = formatResponseDates(data, timezone);
      expect(result.comparison.previous_period_start).toBe('Sunday, September 1, 2024');
      expect(result.comparison.previous_period_end).toBe('Saturday, November 30, 2024');
    });

    it('should format date_of_birth and peak_ctl_date', () => {
      const data = {
        date_of_birth: '1990-05-15',
        summary: {
          peak_ctl_date: '2024-11-20',
        },
      };
      const result = formatResponseDates(data, timezone);
      expect(result.date_of_birth).toBe('Tuesday, May 15, 1990');
      expect(result.summary.peak_ctl_date).toBe('Wednesday, November 20, 2024');
    });

    it('should format created field in workout notes', () => {
      const data = {
        notes: [
          {
            author: 'Test User',
            created: '2024-12-15T14:30:00Z',
            content: 'Great workout!',
          },
        ],
      };
      const result = formatResponseDates(data, timezone);
      expect(result.notes[0].created).toBe('Sunday, December 15, 2024 at 9:30 AM EST');
      expect(result.notes[0].author).toBe('Test User');
    });

    it('should format start_date and end_date', () => {
      const data = {
        period: {
          start_date: '2024-01-01',
          end_date: '2024-12-31',
        },
      };
      const result = formatResponseDates(data, timezone);
      expect(result.period.start_date).toBe('Monday, January 1, 2024');
      expect(result.period.end_date).toBe('Tuesday, December 31, 2024');
    });

    it('should return primitives unchanged', () => {
      expect(formatResponseDates(42, timezone)).toBe(42);
      expect(formatResponseDates('hello', timezone)).toBe('hello');
      expect(formatResponseDates(true, timezone)).toBe(true);
      expect(formatResponseDates(null, timezone)).toBe(null);
      expect(formatResponseDates(undefined, timezone)).toBe(undefined);
    });
  });
});
