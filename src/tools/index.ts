import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient, WhoopApiError } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { CurrentTools } from './current.js';
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';
import {
  combineFieldDescriptions,
  getFieldDescriptions,
} from '../utils/field-descriptions.js';
import { buildToolResponse } from '../utils/response-builder.js';

interface ResponseOptions<TResult> {
  fieldDescriptions: Record<string, string>;
  getNextActions?: (data: TResult) => string[] | undefined;
  getWarnings?: (data: TResult) => string[] | undefined;
}

/**
 * Wraps a tool handler with response building and Whoop error handling.
 * Combines error handling with contextual response formatting.
 */
function withToolResponse<TArgs, TResult>(
  handler: (args: TArgs) => Promise<TResult>,
  options: ResponseOptions<TResult>
): (args: TArgs) => Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return async (args: TArgs) => {
    try {
      const data = await handler(args);
      return buildToolResponse({
        data,
        fieldDescriptions: options.fieldDescriptions,
        nextActions: options.getNextActions?.(data),
        warnings: options.getWarnings?.(data),
      });
    } catch (error) {
      if (error instanceof WhoopApiError && error.isRetryable) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: true,
              retryable: true,
              message: error.message,
              suggestion: 'This is a temporary issue. Please retry this tool call.',
            }, null, 2),
          }],
        };
      }
      throw error;
    }
  };
}

export interface ToolsConfig {
  intervals: { apiKey: string; athleteId: string };
  whoop?: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  } | null;
  trainerroad?: { calendarUrl: string } | null;
}

export class ToolRegistry {
  private currentTools: CurrentTools;
  private historicalTools: HistoricalTools;
  private planningTools: PlanningTools;

  constructor(config: ToolsConfig) {
    const intervalsClient = new IntervalsClient(config.intervals);
    const whoopClient = config.whoop ? new WhoopClient(config.whoop) : null;
    const trainerroadClient = config.trainerroad
      ? new TrainerRoadClient(config.trainerroad)
      : null;

    // Connect Whoop client to Intervals.icu timezone for proper date filtering
    if (whoopClient) {
      whoopClient.setTimezoneGetter(() => intervalsClient.getAthleteTimezone());
    }

    this.currentTools = new CurrentTools(
      intervalsClient,
      whoopClient,
      trainerroadClient
    );
    this.historicalTools = new HistoricalTools(intervalsClient, whoopClient);
    this.planningTools = new PlanningTools(intervalsClient, trainerroadClient);
  }

  /**
   * Register all tools with the MCP server
   */
  registerTools(server: McpServer): void {
    // Current/Recent Data Tools
    server.tool(
      'get_todays_recovery',
      `Returns today's Whoop recovery and sleep data.

<notes>
- Sleep and recovery metrics are calculated by Whoop once a day, when the user wakes up,
and will not be updated throughout the day.
- Returns null if Whoop is not configured.
</notes>`,
      {},
      withToolResponse(
        async () => this.currentTools.getTodaysRecovery(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_recovery', 'recovery'),
          getNextActions: (data) => data.recovery
            ? ['Use get_recovery_trends to see patterns over time', 'Use get_daily_summary for full today overview']
            : undefined,
        }
      )
    );

    server.tool(
      'get_todays_strain',
      `Fetches today's Whoop strain data, including any activities logged in the Whoop app.

<notes>
- Returns null if Whoop is not configured.
</notes>`,
      {},
      withToolResponse(
        async () => this.currentTools.getTodaysStrain(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_strain', 'whoop'),
          getNextActions: (data) => data.strain
            ? ['Use get_strain_history for trends over time', 'Use get_daily_summary for full today overview']
            : undefined,
        }
      )
    );

    server.tool(
      'get_todays_completed_workouts',
      `Fetches all workouts and fitness activities the user has completed today from Intervals.icu.`,
      {},
      withToolResponse(
        async () => this.currentTools.getTodaysCompletedWorkouts(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_completed_workouts', 'workout', 'whoop'),
          getNextActions: (data) => data.workouts && data.workouts.length > 0
            ? [
                'Use get_workout_intervals(activity_id) for interval breakdown',
                'Use get_workout_notes(activity_id) for athlete comments',
                'Use get_workout_weather(activity_id) for outdoor workout conditions',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_strain_history',
      `Fetches Whoop strain data for a date range, including activities logged by the user in the Whoop app.

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- If you only need to get today\'s strain data, it's more efficient to call get_todays_strain.
- Returns empty array if Whoop is not configured.
</notes>`,
      {
        start_date: z.string().describe('Start date - ISO format (YYYY-MM-DD) or natural language (e.g., "7 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string }) => this.currentTools.getStrainHistory(args),
        {
          fieldDescriptions: getFieldDescriptions('whoop'),
          getNextActions: (data) => data && data.length > 0
            ? [
                'Use get_recovery_trends for same period to correlate strain with recovery',
                'Use get_workout_history for detailed workout data from Intervals.icu',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_todays_planned_workouts',
      `Fetches all workouts and fitness activities the user has planned for today, from both TrainerRoad and Intervals.icu calendars.

<notes>
- Planned workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {},
      withToolResponse(
        async () => this.currentTools.getTodaysPlannedWorkouts(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_planned_workouts', 'planned'),
          getNextActions: (data) => data.workouts && data.workouts.length > 0
            ? [
                'Use get_todays_recovery to check readiness for planned workouts',
                'Use get_upcoming_workouts to see the full week ahead',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_athlete_profile',
      `Returns the athlete's profile from Intervals.icu including:
  - Athlete info: name, location, timezone, gender, date of birth, and age.
  - The user's preferred unit system (metric or imperial, with optional overrides for weight and temperature).

<use-cases>
- Fetching the user\'s preferred unit system, which **MUST** be used in all responses.
- Fetching the user\'s name, which may be useful to identify the user\'s notes from a workout in get_workout_notes.
- Fetching the user\'s age, which may be important to interpret their fitness and performance trends over time.
</use-cases>

<instructions>
- You **MUST** use the user\'s preferred units in all responses.
- If you don't know the user's preferred units, you **MUST** call this tool before responding to the user, so you can get their preferences.
</instructions>`,
      {},
      withToolResponse(
        async () => this.currentTools.getAthleteProfile(),
        {
          fieldDescriptions: getFieldDescriptions('athlete_profile'),
          getNextActions: () => [
            'Use get_sports_settings(sport) for FTP, zones, and thresholds',
            'Use get_training_load_trends to see how fitness has evolved',
          ],
        }
      )
    );

    server.tool(
      'get_sports_settings',
      `Fetches settings from Intervals.icu for a single sport, including FTP, power zones, pace zones, HR zones. Supports cycling, running, and swimming.

<notes>
- This returns the athlete's **current** zones, which may not match the zones in historical workouts.
</notes>`,
      {
        sport: z.enum(['cycling', 'running', 'swimming']).describe('The sport to get settings for'),
      },
      withToolResponse(
        async (args: { sport: 'cycling' | 'running' | 'swimming' }) => this.currentTools.getSportSettings(args.sport),
        {
          fieldDescriptions: getFieldDescriptions('sport_settings'),
          getNextActions: () => [
            'Use this tool to understand the user\'s current zones for a given sport',
            'Use get_workout_history to see workouts for this sport',
          ],
        }
      )
    );

    server.tool(
      'get_daily_summary',
      `Fetches a complete snapshot of the user\'s status today, including:
- Whoop recovery, sleep performance, and strain
- Fitness metrics: CTL (fitness), ATL (fatigue), TSB (form), plus today's training load
- The user\'s weight
- All workouts and fitness activities completed today
- All workouts and fitness activities scheduled for today

<instructions>
- Use this if you need a complete picture of the user\'s status today; it's more efficient than calling individual tools when you need the full picture.
</instructions>

<notes>
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {},
      withToolResponse(
        async () => this.currentTools.getDailySummary(),
        {
          fieldDescriptions: combineFieldDescriptions('daily_summary', 'recovery', 'whoop', 'workout', 'planned', 'fitness', 'wellness'),
          getNextActions: (data) => {
            const actions: string[] = [];
            if (data.completed_workouts && data.completed_workouts.length > 0) {
              actions.push('Use get_workout_intervals(activity_id) for detailed analysis of a workout\'s intervals');
              actions.push('Use get_workout_notes(activity_id) to get the user\'s comments about a workout');
              actions.push('Use get_workout_weather(activity_id) to get the weather conditions during a workout, if it was done outdoors');
            }
            if (data.whoop.recovery) {
              actions.push('Use get_recovery_trends to see patterns over time');
            }
            actions.push('Use get_training_load_trends for fitness/fatigue analysis');
            return actions;
          },
          getWarnings: (data) => {
            const warnings: string[] = [];
            if (!data.whoop.recovery) {
              warnings.push('Whoop recovery data unavailable');
            }
            if (!data.whoop.strain) {
              warnings.push('Whoop strain data unavailable');
            }
            return warnings.length > 0 ? warnings : undefined;
          },
        }
      )
    );

    // Historical/Trends Tools
    server.tool(
      'get_workout_history',
      `Fetches all completed workouts and fitness activities in the given date range, with comprehensive metrics.

<notes>
- Date parameters accept ISO dates (YYYY-MM-DD) or natural language ("30 days ago", "last Monday", "December 1", "last month", etc.)
- You can optionally filter activities by sport, as needed.
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) => this.historicalTools.getWorkoutHistory(args),
        {
          fieldDescriptions: combineFieldDescriptions('workout', 'whoop'),
          getNextActions: (data) => data && data.length > 0
            ? [
                'Use get_workout_intervals(activity_id) for detailed analysis of a workout\'s intervals',
                'Use get_workout_notes(activity_id) to get the user\'s comments about a workout',
                'Use get_workout_weather(activity_id) to get the weather conditions during a workout, if it was done outdoors',
                'Use get_recovery_trends for the same period to correlate with training',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_recovery_trends',
      `Fetches Whoop recovery and sleep data over a date range.

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- If you only need to get today\'s recovery and sleep data, it's more efficient to call get_todays_recovery.
- Returns empty array if Whoop is not configured.
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string }) => this.historicalTools.getRecoveryTrends(args),
        {
          fieldDescriptions: getFieldDescriptions('recovery'),
          getNextActions: (data) => data && data.data && data.data.length > 0
            ? [
                'Use get_training_load_trends to correlate with training stress',
                'Use get_workout_history for same period to see training patterns',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_wellness_trends',
      `Fetches wellness data over a date range from Intervals.icu.

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- Wellness data currently only includes the user\'s weight.
- Only returns days on which wellness data was recorded.
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string }) => this.historicalTools.getWellnessTrends(args),
        {
          fieldDescriptions: getFieldDescriptions('wellness'),
          getNextActions: (data) => data && data.data && data.data.length > 0
            ? [
                'Use get_training_load_trends to correlate with training stress',
                'Use get_workout_history to correlate with workout history',
              ]
            : undefined,
        }
      )
    );

    // Planning Tools
    server.tool(
      'get_upcoming_workouts',
      `Fetches planned workouts and fitness activity for a future date range, with an optional sport filter.

<notes>
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {
        days: z.number().optional().default(7).describe('Number of days ahead to look (default: 7, max: 30)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        async (args: { days?: number; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) => this.planningTools.getUpcomingWorkouts({ days: args.days ?? 7, sport: args.sport }),
        {
          fieldDescriptions: getFieldDescriptions('planned'),
          getNextActions: (data) => data && data.length > 0
            ? [
                'Use get_training_load_trends to see current fitness/fatigue',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_planned_workout_details',
      `Fetches planned workouts and fitness activity for a future date, with an optional sport filter.
      
<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Tomorrow", "Next monday", etc.)
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {
        date: z.string().describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday", "tomorrow")'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        async (args: { date: string; sport?: 'cycling' | 'running' | 'swimming' }) => this.planningTools.getPlannedWorkoutDetails(args),
        {
          fieldDescriptions: getFieldDescriptions('planned'),
          getNextActions: (data) => data && data.length > 0
            ? [
                'Use get_upcoming_workouts to see the full schedule',
                'Use get_todays_recovery to check readiness if workout is today',
              ]
            : ['Use get_upcoming_workouts to find workouts on other dates'],
        }
      )
    );

    // ============================================
    // Analysis Tools
    // ============================================

    server.tool(
      'get_training_load_trends',
      `Returns training load metrics, including CTL, ATL, TSB, ramp rate, and ACWR, over a specified period of time.`,
      {
        days: z
          .number()
          .optional()
          .default(42)
          .describe('Number of days of history to analyze (default: 42, max: 365)'),
      },
      withToolResponse(
        async (args: { days?: number }) => this.historicalTools.getTrainingLoadTrends(args.days),
        {
          fieldDescriptions: getFieldDescriptions('fitness'),
          getNextActions: () => [
            'Use get_recovery_trends to correlate with sleep/HRV',
            'Use get_workout_history to see what drove these trends',
          ],
          getWarnings: (data) => {
            const warnings: string[] = [];
            if (data?.summary?.acwr !== undefined && data.summary.acwr > 1.5) {
              warnings.push(`ACWR is ${data.summary.acwr.toFixed(2)} - high injury risk. Consider reducing load.`);
            } else if (data?.summary?.acwr !== undefined && data.summary.acwr > 1.3) {
              warnings.push(`ACWR is ${data.summary.acwr.toFixed(2)} - approaching injury risk zone.`);
            }
            if (data?.summary?.avg_ramp_rate !== undefined && data.summary.avg_ramp_rate > 10) {
              warnings.push(`Ramp rate is ${data.summary.avg_ramp_rate.toFixed(1)} pts/week - exceeds safe limit.`);
            }
            return warnings.length > 0 ? warnings : undefined;
          },
        }
      )
    );

    server.tool(
      'get_workout_intervals',
      `Fetches a detailed interval breakdown for a specific workout.

<instructions>
Get the activity_id from:
- get_workout_history (for past workouts)
- get_todays_completed_workouts (for today's workouts)
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutIntervals(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('intervals'),
          getNextActions: () => [
            'Use get_workout_notes for athlete comments on this workout',
            'Use get_workout_weather for outdoor workout conditions',
          ],
        }
      )
    );

    server.tool(
      'get_workout_notes',
      `Fetches notes attached to a specific workout, which may be comments made by the user, or other Intervals.icu users, like a coach.

<use-cases>
- Understanding how the user may have subjectively felt during a workout, and anything else not captured by objective fitness metrics.
- Reading feedback left by other Intervals.icu users, which could be a coach or a follower.
</use-cases>

<instructions>
- **ALWAYS** fetch this when analyzing a workout; it may include valuable subjective data from the user.
- Get the activity_id from get_workout_history (for past workouts) or get_todays_completed_workouts (for today's workouts)
- Make sure to fetch attachments and follow links left in the notes.
- Make sure to identify which comments are coming from the user when interpreting the data. Ask the user for clarification if there are comments left by other people.
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutNotes(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('notes'),
          getNextActions: () => [
            'Use get_workout_intervals for objective interval data',
            'Use get_workout_weather for outdoor workout conditions',
          ],
        }
      )
    );

    server.tool(
      'get_workout_weather',
      `Fetches the weather conditions during a given outdoor workout.

<use-cases>
- Understanding how weather conditions may or may not have impacted the user\'s performance during outdoor workouts or fitness activities.
</use-cases>

<instructions>
- **ALWAYS** fetch this when analyzing an **OUTDOOR** workout; weather conditions can be an important factor in the user\'s performance.
- **NEVER** fetch this when analyzing an **INDOOR** workout; weather conditions are irrelevant for indoor activities.
- Get the activity_id from get_workout_history (for past workouts) or get_todays_completed_workouts (for today's workouts)
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutWeather(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('weather'),
          getNextActions: () => [
            'Use get_workout_intervals for detailed power/HR data',
            'Use get_workout_notes for athlete comments',
          ],
        }
      )
    );

    // ============================================
    // Performance Curves
    // ============================================

    server.tool(
      'get_power_curve',
      `Fetches cycling power curves showing best power output at various durations for a given date range.

<instructions>
- Optional: Use compare_to_start and compare_to_end if you need to compare changes to a previous period.
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      {
        start_date: z.string().describe('Start of analysis period - ISO format (YYYY-MM-DD) or natural language'),
        end_date: z.string().optional().describe('End of analysis period (defaults to today)'),
        durations: z.array(z.number()).optional().describe('Custom durations in seconds (e.g., [5, 60, 300, 1200, 7200])'),
        compare_to_start: z.string().optional().describe('Start of comparison period for before/after analysis'),
        compare_to_end: z.string().optional().describe('End of comparison period'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string; durations?: number[]; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getPowerCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('power_curve'),
          getNextActions: (data) => {
            const actions = ['Use get_training_load_trends to correlate power with fitness'];
            if (data && data.activity_count > 0) {
              actions.push('Use get_workout_history to see the workouts that produced these bests');
            }
            return actions;
          },
        }
      )
    );

    server.tool(
      'get_pace_curve',
      `Fetches pace curves for swimming or running, showing best times at various distances for a given date range.

<instructions>
- Optional: Use compare_to_start and compare_to_end if you need to compare changes to a previous period
- Optional: Use the GAP setting to use gradient-adjusted pace, which normalizes for hills (only applicable for running)
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      {
        start_date: z.string().describe('Start of analysis period - ISO format (YYYY-MM-DD) or natural language'),
        end_date: z.string().optional().describe('End of analysis period (defaults to today)'),
        sport: z.enum(['running', 'swimming']).describe('Sport to analyze'),
        distances: z.array(z.number()).optional().describe('Custom distances in meters (e.g., [400, 1000, 5000])'),
        gap: z.boolean().optional().describe('Use gradient-adjusted pace for running (normalizes for hills)'),
        compare_to_start: z.string().optional().describe('Start of comparison period for before/after analysis'),
        compare_to_end: z.string().optional().describe('End of comparison period'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string; sport: 'running' | 'swimming'; distances?: number[]; gap?: boolean; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getPaceCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('pace_curve'),
          getNextActions: (data) => {
            const actions = ['Use get_training_load_trends to correlate pace with fitness'];
            if (data && data.activity_count > 0) {
              actions.push('Use get_workout_history to see the workouts that produced these bests');
            }
            return actions;
          },
        }
      )
    );

    server.tool(
      'get_hr_curve',
      `Fetches HR curves showing maximum sustained heart rate at various durations for a given date range.

<instructions>
- Optional: Use compare_to_start and compare_to_end if you need to compare changes to a previous period
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      {
        start_date: z.string().describe('Start of analysis period - ISO format (YYYY-MM-DD) or natural language'),
        end_date: z.string().optional().describe('End of analysis period (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport (omit for all sports)'),
        durations: z.array(z.number()).optional().describe('Custom durations in seconds (e.g., [5, 60, 300, 1200])'),
        compare_to_start: z.string().optional().describe('Start of comparison period for before/after analysis'),
        compare_to_end: z.string().optional().describe('End of comparison period'),
      },
      withToolResponse(
        async (args: { start_date: string; end_date?: string; sport?: 'cycling' | 'running' | 'swimming'; durations?: number[]; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getHRCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('hr_curve'),
          getNextActions: () => [
            'Use get_training_load_trends to correlate HR with fitness',
            'Use get_recovery_trends to see how HR relates to recovery',
          ],
        }
      )
    );
  }
}
