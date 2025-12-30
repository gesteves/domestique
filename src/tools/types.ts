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
  oldest: DateParamSchema.describe('Start date for the query'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
});

export const GetWorkoutHistoryParams = z.object({
  oldest: DateParamSchema.describe('Start date for the query'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
  sport: SportFilterSchema,
});

export const GetRecoveryTrendsParams = z.object({
  oldest: DateParamSchema.describe('Start date for the query'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
});

export const GetUpcomingWorkoutsParams = z.object({
  oldest: DateParamSchema.optional().describe('Start date - defaults to today. ISO format (YYYY-MM-DD) or natural language (e.g., "today", "tomorrow")'),
  newest: DateParamSchema.optional().describe('End date - defaults to 7 days from oldest'),
  sport: SportFilterSchema,
});

export const GetPlannedWorkoutDetailsParams = z.object({
  date: DateParamSchema.describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday")'),
  sport: z
    .enum(['cycling', 'running', 'swimming'])
    .optional()
    .describe('Filter by sport type (e.g., "cycling" for bike workouts)'),
});

export const GetActivityTotalsParams = z.object({
  oldest: DateParamSchema.describe('Start date for the query (e.g., "365 days ago", "2024-01-01")'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
  sports: z
    .array(z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']))
    .optional()
    .describe('Filter to specific sports. If blank, returns all sports.'),
});

// Type exports
export type GetStrainHistoryInput = z.infer<typeof GetStrainHistoryParams>;
export type GetWorkoutHistoryInput = z.infer<typeof GetWorkoutHistoryParams>;
export type GetRecoveryTrendsInput = z.infer<typeof GetRecoveryTrendsParams>;
export type GetUpcomingWorkoutsInput = z.infer<typeof GetUpcomingWorkoutsParams>;
export type GetPlannedWorkoutDetailsInput = z.infer<typeof GetPlannedWorkoutDetailsParams>;
export type GetActivityTotalsInput = z.infer<typeof GetActivityTotalsParams>;
