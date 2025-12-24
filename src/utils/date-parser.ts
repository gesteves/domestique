import * as chrono from 'chrono-node';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfDay,
  endOfDay,
  parseISO,
} from 'date-fns';
import type { DateRange } from '../types/index.js';

/**
 * Parse a natural language date string into an ISO date string.
 * Uses chrono-node for comprehensive natural language support.
 *
 * Supports:
 * - ISO dates: "2024-12-15"
 * - Relative: "today", "yesterday", "tomorrow"
 * - Day names: "next wednesday", "last friday"
 * - Offsets: "3 days ago", "in 2 weeks"
 * - Natural: "December 25th", "Jan 15 2025"
 */
export function parseDateString(input: string): string {
  const normalized = input.trim();

  // Try ISO date first (faster path for common case)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  // Use chrono-node for natural language parsing
  const result = chrono.parseDate(normalized);
  if (result) {
    return format(result, 'yyyy-MM-dd');
  }

  throw new Error(`Unable to parse date: "${input}"`);
}

/**
 * Parse a date range from natural language.
 * Returns start and end ISO date strings.
 *
 * Supports:
 * - "today", "this week", "this month"
 * - "last week", "last month"
 * - "last X days/weeks/months"
 */
export function parseDateRange(input: string): DateRange {
  const normalized = input.toLowerCase().trim();
  const now = new Date();

  // "today"
  if (normalized === 'today') {
    const today = format(now, 'yyyy-MM-dd');
    return { start: today, end: today };
  }

  // "this week"
  if (normalized === 'this week') {
    return {
      start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }

  // "last week"
  if (normalized === 'last week') {
    const lastWeekDate = chrono.parseDate('last week') ?? subDays(now, 7);
    return {
      start: format(startOfWeek(lastWeekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(lastWeekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }

  // "this month"
  if (normalized === 'this month') {
    return {
      start: format(startOfMonth(now), 'yyyy-MM-dd'),
      end: format(endOfMonth(now), 'yyyy-MM-dd'),
    };
  }

  // "last month"
  if (normalized === 'last month') {
    const lastMonthDate = chrono.parseDate('last month') ?? subDays(now, 30);
    return {
      start: format(startOfMonth(lastMonthDate), 'yyyy-MM-dd'),
      end: format(endOfMonth(lastMonthDate), 'yyyy-MM-dd'),
    };
  }

  // "last X days"
  const lastDaysMatch = normalized.match(/^last\s+(\d+)\s*days?$/);
  if (lastDaysMatch) {
    const days = parseInt(lastDaysMatch[1], 10);
    return {
      start: format(subDays(now, days), 'yyyy-MM-dd'),
      end: format(now, 'yyyy-MM-dd'),
    };
  }

  // "last X weeks"
  const lastWeeksMatch = normalized.match(/^last\s+(\d+)\s*weeks?$/);
  if (lastWeeksMatch) {
    const weeks = parseInt(lastWeeksMatch[1], 10);
    return {
      start: format(subDays(now, weeks * 7), 'yyyy-MM-dd'),
      end: format(now, 'yyyy-MM-dd'),
    };
  }

  // "last X months"
  const lastMonthsMatch = normalized.match(/^last\s+(\d+)\s*months?$/);
  if (lastMonthsMatch) {
    const months = parseInt(lastMonthsMatch[1], 10);
    // Approximate months as 30 days
    return {
      start: format(subDays(now, months * 30), 'yyyy-MM-dd'),
      end: format(now, 'yyyy-MM-dd'),
    };
  }

  throw new Error(`Unable to parse date range: "${input}"`);
}

/**
 * Get date range for "X days" including today.
 * days=1 means today only, days=7 means today plus 6 previous days.
 */
export function getDaysBackRange(days: number): DateRange {
  const now = new Date();
  // Ensure at least 1 day
  const daysBack = Math.max(0, days - 1);
  return {
    start: format(subDays(now, daysBack), 'yyyy-MM-dd'),
    end: format(now, 'yyyy-MM-dd'),
  };
}

/**
 * Get today's date as ISO string (uses server timezone)
 */
export function getToday(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Get today's date as ISO string in the specified timezone
 */
export function getTodayInTimezone(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * Parse a natural language date string into an ISO date string,
 * using the specified timezone for relative dates.
 *
 * Uses chrono-node with timezone context for accurate parsing.
 */
export function parseDateStringInTimezone(input: string, timezone: string): string {
  const normalized = input.trim();

  // Try ISO date first - these are absolute, no timezone needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  // Get the current time in the target timezone
  const nowInTz = new Date(
    new Date().toLocaleString('en-US', { timeZone: timezone })
  );

  // Use chrono-node with reference date in the target timezone
  const result = chrono.parseDate(normalized, nowInTz);
  if (result) {
    return format(result, 'yyyy-MM-dd');
  }

  throw new Error(`Unable to parse date: "${input}"`);
}

/**
 * Get start of day as ISO datetime
 */
export function getStartOfDay(date: string): string {
  return startOfDay(parseISO(date)).toISOString();
}

/**
 * Get end of day as ISO datetime
 */
export function getEndOfDay(date: string): string {
  return endOfDay(parseISO(date)).toISOString();
}
