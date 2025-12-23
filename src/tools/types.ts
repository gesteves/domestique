import { z } from 'zod';

// Schema for date parameter that accepts both ISO dates and natural language
export const DateParamSchema = z.string().describe(
  'Date in ISO format (YYYY-MM-DD) or natural language (e.g., "today", "yesterday", "3 days ago")'
);

// Schema for sport filter
export const SportFilterSchema = z
  .enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength'])
  .optional()
  .describe('Filter by sport type');

// Tool parameter schemas
export const GetStrainHistoryParams = z.object({
  start_date: DateParamSchema.describe('Start date for the query'),
  end_date: DateParamSchema.optional().describe('End date (defaults to today)'),
});

export const GetWorkoutHistoryParams = z.object({
  start_date: DateParamSchema.describe('Start date for the query'),
  end_date: DateParamSchema.optional().describe('End date (defaults to today)'),
  sport: SportFilterSchema,
});

export const GetRecoveryTrendsParams = z.object({
  start_date: DateParamSchema.describe('Start date for the query'),
  end_date: DateParamSchema.optional().describe('End date (defaults to today)'),
});

export const GetUpcomingWorkoutsParams = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe('Number of days ahead to look (default: 7, max: 30)'),
  sport: SportFilterSchema,
});

export const GetPlannedWorkoutDetailsParams = z.object({
  date: DateParamSchema.describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday")'),
  sport: z
    .enum(['cycling', 'running', 'swimming'])
    .optional()
    .describe('Filter by sport type (e.g., "cycling" for bike workouts)'),
});

// Type exports
export type GetStrainHistoryInput = z.infer<typeof GetStrainHistoryParams>;
export type GetWorkoutHistoryInput = z.infer<typeof GetWorkoutHistoryParams>;
export type GetRecoveryTrendsInput = z.infer<typeof GetRecoveryTrendsParams>;
export type GetUpcomingWorkoutsInput = z.infer<typeof GetUpcomingWorkoutsParams>;
export type GetPlannedWorkoutDetailsInput = z.infer<typeof GetPlannedWorkoutDetailsParams>;
