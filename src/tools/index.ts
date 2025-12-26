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
      `<usecase>
Use when the user asks about:
- How they recovered overnight or their readiness for today
- Sleep quality, HRV, or resting heart rate from last night
- Whether they should train hard today based on recovery

Do NOT use for:
- Historical recovery trends (use get_recovery_trends)
- General "how am I doing today" questions (use get_daily_summary)
</usecase>

<instructions>
Fetches today's Whoop recovery data including:
- Recovery score (0-100%) with level: SUFFICIENT (≥67%), ADEQUATE (34-66%), LOW (<34%)
- HRV RMSSD in milliseconds
- Resting heart rate
- Sleep performance percentage and durations
- Sleep stages (light, deep/SWS, REM, awake)

Returns null if Whoop is not configured.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Today's strain or exertion level
- How hard they've worked today (from Whoop's perspective)
- Calories burned or heart rate data from Whoop today

Do NOT use for:
- Historical strain data (use get_strain_history)
- Detailed workout metrics (use get_todays_completed_workouts)
- General "how am I doing today" questions (use get_daily_summary)
</usecase>

<instructions>
Fetches today's Whoop strain data including:
- Strain score (0-21) with level: LIGHT (0-9), MODERATE (10-13), HIGH (14-17), ALL_OUT (18-21)
- Average and max heart rate
- Calories burned
- List of Whoop-tracked activities

Returns null if Whoop is not configured.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Workouts completed today
- How today's training went
- Comparing planned vs completed workouts for today
- Today's power, TSS, or training metrics

Do NOT use for:
- Historical workouts (use get_workout_history)
- Deep analysis of intervals (use get_workout_intervals with the activity_id)
- General "how am I doing today" questions (use get_daily_summary)
</usecase>

<instructions>
Fetches all completed workouts from Intervals.icu for today:
- Basic metrics: duration, distance, TSS, intensity factor
- Power data: normalized power, average power
- Heart rate: average and max HR
- Matched Whoop strain data (if available)
- Fitness snapshot: CTL, ATL, TSB at time of activity

For detailed analysis, use the activity_id with:
- get_workout_intervals: Interval-by-interval breakdown
- get_workout_notes: Athlete's subjective notes
- get_workout_weather: Weather conditions (outdoor only)

Returns empty array if no workouts completed today.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Strain patterns over a period of time
- Historical exertion or activity levels from Whoop
- Comparing strain across different days or weeks

Do NOT use for:
- Today's strain only (use get_todays_strain)
- Workout details from Intervals.icu (use get_workout_history)
</usecase>

<instructions>
Fetches Whoop strain data for a date range:
- Daily strain scores (0-21) with level classifications
- Heart rate metrics (average, max)
- Calories burned
- Activities tracked by Whoop

Date parameters accept ISO format (YYYY-MM-DD) or natural language:
- "7 days ago", "last week", "2 weeks ago"

Returns empty array if Whoop is not configured.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- What workouts are planned for today
- Today's training schedule
- What they should do today

Do NOT use for:
- Future workouts beyond today (use get_upcoming_workouts)
- Completed workouts (use get_todays_completed_workouts)
- General "how am I doing today" questions (use get_daily_summary)
</usecase>

<instructions>
Fetches planned workouts for today from both TrainerRoad and Intervals.icu:
- Workout name and description
- Expected duration and TSS
- Workout type and discipline (Swim/Bike/Run)
- General structure and goals of the workout (if available)
- Note that planned workouts may not be in the order the user intends to do them;
ask them for clarification if necessary

Deduplicates workouts that appear in both calendars.
Returns empty array if no workouts planned today.
</instructions>`,
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
      `<usecase>
Use when:
- You need to know the user's preferred unit system (metric/imperial) BEFORE responding with data
- The user asks about their profile, age, or location
- The user asks how they want data displayed

Do NOT use for:
- Sport-specific settings like FTP, zones, thresholds (use get_sports_settings)
- Workout data (use get_workout_history or get_todays_completed_workouts)
- Fitness trends over time (use get_training_load_trends)
</usecase>

<instructions>
If you don't know the user's preferred unit system, you **MUST** call this tool before responding to the user, so you can get their preferences.
In addition, users may prefer weights and temperatures displayed in a different unit system (e.g. they may prefer to use metric, but use Fahrenheit for the weather).

Returns the athlete's profile from Intervals.icu including:
- unit_preferences: The user's preferred unit system. You MUST use these units in all responses:
  - system: "metric" or "imperial" - use kilometers/meters or miles/feet/yards for distances
  - weight: "kg" or "lb" - use this for weight regardless of the user's preferred unit system
  - temperature: "celsius" or "fahrenheit" - use this for temps regardless of the user's preferred unit system
- Athlete info: name, location, timezone, sex
- Age and date of birth (if set)

For sport-specific settings (FTP, zones, thresholds), use get_sports_settings with the sport name.
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
      `<usecase>
Use when the user asks about:
- Their FTP, threshold power, or cycling settings
- Running threshold pace or running zones
- Swimming pace or swimming zones
- Training zones (power, heart rate, or pace) for a specific sport
- How to interpret zone data from workouts

Do NOT use for:
- General profile info or unit preferences (use get_athlete_profile)
- Workout data (use get_workout_history or get_todays_completed_workouts)
- Fitness trends over time (use get_training_load_trends)
</usecase>

<instructions>
Fetches sport-specific settings from Intervals.icu for a single sport:
- Cycling: FTP, indoor FTP (if different), power zones
- Running: threshold pace, pace zones, HR zones
- Swimming: threshold pace, pace zones

Also includes unit_preferences so you know how to format responses.

Note: This returns the athlete's **current** zones, which may not match zones in historical workouts.
Use this to interpret zone data or answer questions like "What's my FTP?" or "What are my running zones?"
</instructions>`,
      {
        sport: z.enum(['cycling', 'running', 'swimming']).describe('The sport to get settings for'),
      },
      withToolResponse(
        async (args: { sport: 'cycling' | 'running' | 'swimming' }) => this.currentTools.getSportSettings(args.sport),
        {
          fieldDescriptions: getFieldDescriptions('sport_settings'),
          getNextActions: () => [
            'Use this zone information to interpret power/HR/pace data in workouts',
            'Use get_workout_history to see workouts for this sport',
          ],
        }
      )
    );

    server.tool(
      'get_daily_summary',
      `<usecase>
Use when the user asks general questions about today like:
- "How am I doing today?"
- "Give me a summary of today"
- "What's my status?"
- When you need multiple pieces of today's data at once

Do NOT use for:
- Specific deep-dives (use individual tools for recovery, strain, workouts)
- Historical data (use get_workout_history, get_recovery_trends)
- Future plans (use get_upcoming_workouts)
</usecase>

<instructions>
Fetches a complete snapshot of today in a single call:
- Whoop recovery: score, HRV, sleep metrics with level classifications
- Whoop strain: score, calories, activities with level classifications
- Fitness metrics from Intervals.icu: CTL (fitness), ATL (fatigue), TSB (form), plus ctl_load/atl_load showing today's training impact
- Wellness data from Intervals.icu: weight (in kg)
- Completed workouts from Intervals.icu with matched Whoop data
- Planned workouts from TrainerRoad and Intervals.icu
- Summary stats: workouts completed/remaining, TSS completed/planned
- Note that planned workouts may not be in the order the user intends to do them;
ask them for clarification if necessary

More efficient than calling individual tools when you need the full picture.
For deeper analysis of any component, use the specific tool.
</instructions>`,
      {},
      withToolResponse(
        async () => this.currentTools.getDailySummary(),
        {
          fieldDescriptions: combineFieldDescriptions('daily_summary', 'recovery', 'whoop', 'workout', 'planned', 'fitness', 'wellness'),
          getNextActions: (data) => {
            const actions: string[] = [];
            if (data.completed_workouts && data.completed_workouts.length > 0) {
              actions.push('Use get_workout_intervals(activity_id) for detailed workout analysis');
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
      `<usecase>
Use when the user asks about:
- Workouts over a time period ("last week", "past 30 days")
- Training patterns or volume over time
- Specific sport history ("my runs this month")
- Finding a specific past workout

Do NOT use for:
- Today's workouts only (use get_todays_completed_workouts)
- Single workout deep-dive (get the ID first, then use get_workout_intervals)
- Fitness/load trends (use get_training_load_trends)
</usecase>

<instructions>
Queries completed workouts with flexible date filtering:
- Accepts ISO dates (YYYY-MM-DD) or natural language ("30 days ago", "last Monday", "December 1")
- Optional sport filter: cycling, running, swimming, skiing, hiking, rowing, strength
- Returns comprehensive metrics for each workout
- Includes matched Whoop strain data when available
- Results sorted by date (oldest to newest)

For detailed analysis of specific workouts, use the activity_id with:
- get_workout_intervals: Interval structure and power/HR data
- get_workout_notes: Athlete's comments and observations
- get_workout_weather: Weather conditions (outdoor activities only)

Returns empty array if no workouts match.
</instructions>`,
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
                'Use get_workout_intervals(activity_id) for interval breakdown',
                'Use get_workout_notes(activity_id) for athlete comments',
                'Use get_recovery_trends for same period to correlate with training',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_recovery_trends',
      `<usecase>
Use when the user asks about:
- Recovery patterns over time
- HRV trends or sleep quality trends
- How recovery correlates with training
- Historical sleep or recovery data

Do NOT use for:
- Today's recovery only (use get_todays_recovery)
- Workout data (use get_workout_history)
- Training load analysis (use get_training_load_trends)
</usecase>

<instructions>
Fetches Whoop recovery data over a date range:
- Daily recovery scores with level classifications (SUFFICIENT/ADEQUATE/LOW)
- HRV RMSSD values
- Resting heart rate trends
- Sleep performance percentages with level classifications
- Sleep durations and stages

Date parameters accept ISO format (YYYY-MM-DD) or natural language:
- "today", "yesterday", "30 days ago", "last month", "2 weeks ago"

Use alongside get_training_load_trends to correlate recovery with training stress.
Returns empty array if Whoop is not configured.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Weight trends over time
- Body composition changes
- How weight has changed over a training period
</usecase>

<instructions>
Fetches wellness data over a date range from Intervals.icu:
- Daily weight readings (in kg)
- Period summary showing start and end dates

Date parameters accept ISO format (YYYY-MM-DD) or natural language:
- "today", "yesterday", "30 days ago", "last month", "2 weeks ago"

Use alongside get_training_load_trends to correlate weight changes with training.
Returns data only for days where wellness data was recorded.
</instructions>`,
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
                'Use get_daily_summary for today\'s wellness data',
              ]
            : undefined,
        }
      )
    );

    // Planning Tools
    server.tool(
      'get_upcoming_workouts',
      `<usecase>
Use when the user asks about:
- Upcoming training schedule
- Workouts planned for the next few days/weeks
- What's coming up in their training plan
- Specific sport schedule ("my bike workouts this week")

Do NOT use for:
- Today's planned workouts only (use get_todays_planned_workouts)
- Specific date lookup (use get_planned_workout_details)
- Completed workouts (use get_workout_history)
</usecase>

<instructions>
Fetches planned workouts for a future date range:
- Combines TrainerRoad and Intervals.icu calendars
- Default: next 7 days (max: 30 days)
- Optional sport filter: cycling, running, swimming, etc.
- Deduplicates workouts that appear in both calendars
- Note that planned workouts may not be in the order the user intends to do them;
ask them for clarification if necessary

Returns:
- Workout name and description
- Expected duration and TSS
- Workout type and discipline
- General description of the interval structure and workout goals (if available)

Returns empty array if no workouts planned.
</instructions>`,
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
                'Use get_planned_workout_details(date) for specific day details',
                'Use get_training_load_trends to see current fitness/fatigue',
              ]
            : undefined,
        }
      )
    );

    server.tool(
      'get_planned_workout_details',
      `<usecase>
Use when the user asks about:
- A specific day's planned workout ("What's my workout on Thursday?")
- Details about an upcoming workout on a particular date
- Sport-specific workout on a date ("What's my bike workout next Tuesday?")

Do NOT use for:
- Today's workouts (use get_todays_planned_workouts)
- Range of upcoming workouts (use get_upcoming_workouts)
- Completed workouts (use get_workout_history)
</usecase>

<instructions>
Fetches planned workouts for a specific date:
- Accepts natural language: "today", "yesterday", "next wednesday", "tomorrow", "December 28"
- Accepts ISO format: YYYY-MM-DD
- Optional sport filter: cycling (bike), running (run), swimming (swim)
- Combines TrainerRoad and Intervals.icu calendars

Returns full workout details:
- Name and description
- Expected duration and TSS
- Interval structure (if available)

Returns empty array if no workouts match.
</instructions>`,
      {
        date: z.string().describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday", "tomorrow")'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport type (cycling = bike, running = run, swimming = swim)'),
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
      `<usecase>
Use when the user asks about:
- Fitness trends or training load over time
- Whether they're building or losing fitness
- If they're overtraining or at injury risk
- Form/freshness for an upcoming race
- CTL, ATL, TSB, or ACWR metrics

Do NOT use for:
- Individual workout details (use get_workout_history)
- Recovery/sleep data (use get_recovery_trends)
- Today's summary (use get_daily_summary)
</usecase>

<instructions>
Analyzes training load trends over a specified period (default: 42 days, max: 365):

Key metrics:
- CTL (Chronic Training Load): 42-day rolling fitness
- ATL (Acute Training Load): 7-day rolling fatigue
- TSB (Training Stress Balance): Form = CTL - ATL
  • Positive = fresh/rested
  • Negative = fatigued
  • Race-ready: -10 to +25
- Ramp rate: Weekly CTL change
  • Safe: 3-7 pts/week
  • Aggressive: 7-10 pts/week
  • Injury risk: >10 pts/week
- ACWR (Acute:Chronic Workload Ratio): ATL/CTL
  • Optimal: 0.8-1.3
  • Caution: 1.3-1.5
  • High injury risk: >1.5
- ctl_load: Weighted contribution to CTL from each day's training
- atl_load: Weighted contribution to ATL from each day's training

Returns daily time series (oldest to newest) plus summary statistics.
Use with get_recovery_trends to correlate load with recovery.
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Interval details or structure of a specific workout
- Power or HR data for individual efforts within a workout
- How well they hit their interval targets
- Detailed breakdown of a workout's efforts

Requires: activity_id from get_workout_history or get_todays_completed_workouts

Do NOT use for:
- General workout overview (use get_workout_history first)
- Workout notes or comments (use get_workout_notes)
- Weather during workout (use get_workout_weather)
</usecase>

<instructions>
Fetches detailed interval breakdown for a specific workout:
- Individual intervals with type (WORK/RECOVERY)
- Power metrics: average watts, max watts, normalized power, watts/kg
- Heart rate: average and max HR, HR decoupling
- Cadence and stride length
- Interval groups summarizing repeated efforts (e.g., "5 x 56s @ 314w")
- W'bal (anaerobic capacity) depletion

Get the activity_id first from:
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
      `<usecase>
Use when the user asks about:
- How a workout felt subjectively
- Athlete's comments or observations about a workout
- Coach feedback on a workout
- RPE (Rate of Perceived Exertion) or feel rating

Requires: activity_id from get_workout_history or get_todays_completed_workouts
**ALWAYS** fetch this when analyzing a workout - subjective data is valuable context.

Do NOT use for:
- Objective workout metrics (use get_workout_intervals)
- Weather data (use get_workout_weather)
</usecase>

<instructions>
Fetches notes attached to a specific workout:
- Athlete's own comments and observations
- Coach feedback (if using Intervals.icu coaching features)
- Attachments (if any)
- Creation timestamp and author

Get the activity_id first from:
- get_workout_history (for past workouts)
- get_todays_completed_workouts (for today's workouts)

Returns empty notes array if no notes exist.
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
      `<usecase>
Use when the user asks about:
- Weather conditions during an outdoor workout
- How wind, temperature, or rain affected performance
- Environmental factors during a ride or run

Requires: activity_id from get_workout_history or get_todays_completed_workouts
**ONLY** use for OUTDOOR activities - indoor/trainer workouts have no weather data.

Do NOT use for:
- Indoor/trainer workouts (no weather data available)
- Objective workout metrics (use get_workout_intervals)
- Subjective notes (use get_workout_notes)
</usecase>

<instructions>
Fetches weather conditions during an outdoor workout:
- Temperature (average, min, max)
- Wind speed and direction
- Precipitation and humidity
- Cloud cover

Get the activity_id first from:
- get_workout_history (for past workouts)
- get_todays_completed_workouts (for today's workouts)

Check the is_indoor field first - only fetch weather for outdoor activities.
Returns null if weather data is not available.
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutWeather(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('weather'),
          getNextActions: () => [
            'Use get_workout_intervals for power/HR data',
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
      `<usecase>
Use when the user asks about:
- Cycling power curve or power profile
- Best power at specific durations (5s, 1min, 5min, 20min, etc.)
- Power improvements or changes over time
- Comparing power between two time periods
- W/kg analysis
- FTP estimation from power data

Do NOT use for:
- Running or swimming (use get_pace_curve instead - pace is the primary metric)
- Current/today's workout data (use get_todays_completed_workouts)
</usecase>

<instructions>
Fetches cycling power curves showing best power output at various durations:
- Returns per-activity curves with watts and W/kg
- Summary includes best values at key durations (5s, 30s, 1min, 5min, 20min, 60min, 120min)
- Includes estimated FTP (95% of best 20min power)
- Only for cycling activities (Ride, VirtualRide)
- Custom durations can be specified (e.g., 7200 for 2-hour power)
- Comparison mode: provide compare_to_start and compare_to_end to see changes vs a previous period

Date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month").
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Running pace curve or pace profile
- Swimming pace or split times
- Best times at specific distances (400m, 1km, 5km, etc.)
- Pace improvements or changes over time
- Comparing pace between two time periods

Do NOT use for:
- Cycling (use get_power_curve instead)

**IMPORTANT**: Pace curves are the PRIMARY metric for analyzing running and swimming performance.
Running power curves exist but often have incomplete data - use pace curves for running/swimming.
</usecase>

<instructions>
Fetches pace curves showing best times at various distances:
- For running: analyzes 400m, 1km, mile, 5km, 10km, half-marathon, and marathon distances
- For swimming: analyzes 100m, 200m, 400m, 800m, 1500m, half-iron, and full-iron distances
- Returns pace in appropriate units (min/km for running, /100m for swimming)
- GAP (gradient-adjusted pace) available for running to normalize for hills
- Custom distances can be specified (e.g., [800, 3000])
- Comparison mode: provide compare_to_start and compare_to_end to see changes vs a previous period

Date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month").
</instructions>`,
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
      `<usecase>
Use when the user asks about:
- Heart rate curve or HR profile
- Maximum sustainable heart rate at various durations
- HR changes over time
- Comparing HR between two time periods
- Cardiac drift analysis

Works for all sports (cycling, running, swimming, etc.)
</usecase>

<instructions>
Fetches HR curves showing maximum sustained heart rate at various durations:
- Returns per-activity curves with BPM at each duration
- Summary includes max values at key durations (5s, 30s, 1min, 5min, 20min, 60min)
- Can be filtered by sport or show all activities
- Custom durations can be specified
- Comparison mode: provide compare_to_start and compare_to_end to see changes vs a previous period

Date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month").
</instructions>`,
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
