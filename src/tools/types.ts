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

// Filter for activity event types. Single value; omit to return all event types.
export const ActivityTypeFilterSchema = z
  .enum(['workouts', 'races'])
  .optional()
  .describe('Filter to a single event type. Omit to return all event types.');

export const GetActivityHistoryParams = z.object({
  oldest: DateParamSchema.describe('Start date for the query'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
  sport: SportFilterSchema,
  type: ActivityTypeFilterSchema,
});

export const GetRecoveryTrendsParams = z.object({
  oldest: DateParamSchema.describe('Start date for the query'),
  newest: DateParamSchema.optional().describe('End date (defaults to today)'),
});

export const GetUpcomingActivitiesParams = z.object({
  oldest: DateParamSchema.optional().describe('Start date - defaults to today. ISO format (YYYY-MM-DD) or natural language (e.g., "today", "tomorrow")'),
  newest: DateParamSchema.optional().describe('End date - defaults to 7 days from oldest'),
  sport: SportFilterSchema,
  type: ActivityTypeFilterSchema,
});

export const GetTodaysActivitiesParams = z.object({
  type: ActivityTypeFilterSchema,
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
export type GetActivityHistoryInput = z.infer<typeof GetActivityHistoryParams>;
export type GetRecoveryTrendsInput = z.infer<typeof GetRecoveryTrendsParams>;
export type GetUpcomingActivitiesInput = z.infer<typeof GetUpcomingActivitiesParams>;
export type GetTodaysActivitiesInput = z.infer<typeof GetTodaysActivitiesParams>;
export type GetActivityTotalsInput = z.infer<typeof GetActivityTotalsParams>;
export type ActivityTypeFilter = 'workouts' | 'races';
