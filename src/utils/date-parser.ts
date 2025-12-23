import {
  parseISO,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  format,
  isValid,
  startOfDay,
  endOfDay,
} from 'date-fns';
import type { DateRange } from '../types/index.js';

/**
 * Parse a natural language date string into an ISO date string.
 * Supports:
 * - ISO dates: "2024-12-15"
 * - Relative: "today", "yesterday", "3 days ago", "last week"
 * - Ranges: "this week", "last 30 days"
 */
export function parseDateString(input: string): string {
  const normalized = input.toLowerCase().trim();
  const now = new Date();

  // Try ISO date first
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const parsed = parseISO(input);
    if (isValid(parsed)) {
      return input;
    }
  }

  // Relative dates
  if (normalized === 'today') {
    return format(now, 'yyyy-MM-dd');
  }

  if (normalized === 'yesterday') {
    return format(subDays(now, 1), 'yyyy-MM-dd');
  }

  if (normalized === 'tomorrow') {
    return format(new Date(now.getTime() + 86400000), 'yyyy-MM-dd');
  }

  // "X days ago"
  const daysAgoMatch = normalized.match(/^(\d+)\s*days?\s*ago$/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    return format(subDays(now, days), 'yyyy-MM-dd');
  }

  // "X weeks ago"
  const weeksAgoMatch = normalized.match(/^(\d+)\s*weeks?\s*ago$/);
  if (weeksAgoMatch) {
    const weeks = parseInt(weeksAgoMatch[1], 10);
    return format(subWeeks(now, weeks), 'yyyy-MM-dd');
  }

  // "X months ago"
  const monthsAgoMatch = normalized.match(/^(\d+)\s*months?\s*ago$/);
  if (monthsAgoMatch) {
    const months = parseInt(monthsAgoMatch[1], 10);
    return format(subMonths(now, months), 'yyyy-MM-dd');
  }

  // "last week" - start of last week
  if (normalized === 'last week') {
    return format(startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  }

  // "last month" - start of last month
  if (normalized === 'last month') {
    return format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
  }

  // If nothing matched, try parsing as-is
  const parsed = parseISO(input);
  if (isValid(parsed)) {
    return format(parsed, 'yyyy-MM-dd');
  }

  throw new Error(`Unable to parse date: "${input}"`);
}

/**
 * Parse a date range from natural language.
 * Returns start and end ISO date strings.
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
    const lastWeek = subWeeks(now, 1);
    return {
      start: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
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
    const lastMonth = subMonths(now, 1);
    return {
      start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'),
      end: format(endOfMonth(lastMonth), 'yyyy-MM-dd'),
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
      start: format(subWeeks(now, weeks), 'yyyy-MM-dd'),
      end: format(now, 'yyyy-MM-dd'),
    };
  }

  // "last X months"
  const lastMonthsMatch = normalized.match(/^last\s+(\d+)\s*months?$/);
  if (lastMonthsMatch) {
    const months = parseInt(lastMonthsMatch[1], 10);
    return {
      start: format(subMonths(now, months), 'yyyy-MM-dd'),
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
 * Get today's date as ISO string
 */
export function getToday(): string {
  return format(new Date(), 'yyyy-MM-dd');
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
