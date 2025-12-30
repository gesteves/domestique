import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { CurrentTools } from './current.js';
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';
import {
  combineFieldDescriptions,
  getFieldDescriptions,
} from '../utils/field-descriptions.js';
import { buildToolResponse, type ToolResponse } from '../utils/response-builder.js';
import { ApiError, DateParseError } from '../errors/index.js';

interface ResponseOptions {
  fieldDescriptions: Record<string, string>;
}

interface ErrorDetails {
  error: true;
  message: string;
  what_happened: string;
  how_to_fix: string;
  can_retry: boolean;
  category: string;
  [key: string]: unknown;
}

interface StructuredErrorContent {
  error: ErrorDetails;
  [key: string]: unknown;
}

interface ErrorResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: StructuredErrorContent;
  isError: true;
  [key: string]: unknown;
}

/**
 * Build a structured error response for LLM consumption.
 * All errors are caught and formatted consistently.
 */
function buildErrorResponse(error: unknown): ErrorResponse {
  let errorDetails: ErrorDetails;

  // Handle DateParseError specifically for better date guidance
  if (error instanceof DateParseError) {
    errorDetails = {
      error: true,
      message: error.message,
      what_happened: error.getWhatHappened(),
      how_to_fix: error.getHowToFix(),
      can_retry: false,
      category: 'date_parse',
      parameter: error.parameterName,
      input_received: error.input,
    };
  } else if (error instanceof ApiError) {
    // Handle our unified ApiError and its subclasses
    errorDetails = {
      error: true,
      message: error.message,
      what_happened: error.getWhatHappened(),
      how_to_fix: error.getHowToFix(),
      can_retry: error.isRetryable,
      category: error.category,
      source: error.source,
    };
  } else {
    // Handle unknown errors
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    errorDetails = {
      error: true,
      message,
      what_happened: 'An unexpected error occurred while processing the request.',
      how_to_fix: 'Please try again. If the issue persists, there may be a problem with the service.',
      can_retry: true,
      category: 'internal',
    };
  }

  const structuredContent = { error: errorDetails };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: true,
  };
}

/**
 * Wraps a tool handler with response building and comprehensive error handling.
 * Catches all errors and formats them consistently for LLM consumption.
 */
function withToolResponse<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
  options: ResponseOptions
): (args: TArgs) => Promise<ToolResponse | ErrorResponse> {
  return async (args: TArgs) => {
    console.log(`[Tool] Calling tool: ${toolName}`);
    try {
      const data = await handler(args);
      return buildToolResponse({
        data,
        fieldDescriptions: options.fieldDescriptions,
      });
    } catch (error) {
      return buildErrorResponse(error);
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
    // Daily Summary (most likely to be called first)
    server.tool(
      'get_daily_summary',
      `Fetches a complete snapshot of the user's current status today, including:
- Whoop recovery, sleep performance, and strain
- Fitness metrics: CTL (fitness), ATL (fatigue), TSB (form), plus today's training load
- Wellness metrics, such as vitals and subjective status
- All workouts and fitness activities completed so far today
- All workouts and fitness activities scheduled for today
- All upcoming races on the user's calendar

<use-cases>
- Getting a comprehensive overview of the user's current status in a single call.
- Assessing readiness for training by combining recovery, fitness, and planned workouts.
- Understanding the balance between completed and planned training load.
- Providing a complete daily status report without multiple tool calls.
</use-cases>

<instructions>
- Use this if you need a complete picture of the user's status today; it's more efficient than calling individual tools when you need the full picture.
- Metrics and activities (completed and schedule) can change over the course of the day; agents are encourage to call this tool as the day progresses to get up-to-the-minute data rather than rely on the results of previous call
</instructions>

<notes>
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      {},
      withToolResponse(
        'get_daily_summary',
        async () => this.currentTools.getDailySummary(),
        {
          fieldDescriptions: combineFieldDescriptions('daily_summary', 'sleep', 'recovery', 'body_measurements', 'whoop', 'workout', 'planned', 'fitness', 'wellness'),
        }
      )
    );

    // Daily Tools (in order of likelihood)
    server.tool(
      'get_todays_recovery',
      `Returns today's Whoop recovery and sleep data.

<use-cases>
- Checking the user's readiness for training based on recovery score and HRV.
- Understanding sleep quality and duration to assess recovery status.
- Determining if the user should adjust their training intensity based on recovery metrics.
- Providing context for why the user may be feeling tired or energized.
</use-cases>

<notes>
- Sleep and recovery metrics are calculated by Whoop once a day, when the user wakes up,
and will not be updated throughout the day.
- Returns null if Whoop is not configured.
</notes>`,
      {},
      withToolResponse(
        'get_todays_recovery',
        async () => this.currentTools.getTodaysRecovery(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_recovery', 'sleep', 'recovery'),
        }
      )
    );

    server.tool(
      'get_todays_strain',
      `Fetches today's Whoop strain data, including any activities logged in the Whoop app.

<use-cases>
- Checking how much physiological stress the user has accumulated today.
- Understanding if the user has already done enough training for the day.
- Assessing whether planned workouts should be adjusted based on current strain.
- Correlating strain with recovery to understand training-recovery balance.
</use-cases>

<notes>
- Returns null if Whoop is not configured.
</notes>`,
      {},
      withToolResponse(
        'get_todays_strain',
        async () => this.currentTools.getTodaysStrain(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_strain', 'whoop'),
        }
      )
    );

    server.tool(
      'get_todays_completed_workouts',
      `Fetches all workouts and fitness activities the user has completed today from Intervals.icu.

<use-cases>
- Reviewing what workouts the user has already completed today.
- Checking training load (TSS) accumulated so far today.
- Identifying workouts that may need detailed analysis via get_workout_intervals.
- Understanding the user's training volume and intensity for the day.
- Understanding total time in zones for the day (power, pace, heart race, and/or heat zones).
</use-cases>

<notes>
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      {},
      withToolResponse(
        'get_todays_completed_workouts',
        async () => this.currentTools.getTodaysCompletedWorkouts(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_completed_workouts', 'workout', 'whoop'),
        }
      )
    );

    server.tool(
      'get_todays_planned_workouts',
      `Fetches all workouts and fitness activities the user has planned for today, from both TrainerRoad and Intervals.icu calendars.

<use-cases>
- Checking what workouts the user has scheduled for today.
- Understanding expected training load (TSS) for the day.
- Determining if planned workouts are appropriate given recovery status.
- Helping the user plan their day around scheduled training.
</use-cases>

<notes>
- Planned workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {},
      withToolResponse(
        'get_todays_planned_workouts',
        async () => this.currentTools.getTodaysPlannedWorkouts(),
        {
          fieldDescriptions: combineFieldDescriptions('todays_planned_workouts', 'planned'),
        }
      )
    );

    // Profile and Settings (needed early for context)
    server.tool(
      'get_athlete_profile',
      `Returns the athlete's profile from Intervals.icu including:
  - Athlete info: name, location, timezone, gender, date of birth, and age.
  - The user's preferred unit system (metric or imperial, with optional overrides for weight and temperature).

<use-cases>
- Fetching the user's preferred unit system, which **MUST** be used in all responses.
- Fetching the user's name, which may be useful to identify the user's notes from a workout.
- Fetching the user's age, which may be important to interpret their fitness and performance trends over time.
</use-cases>

<instructions>
- You **MUST** use the user's preferred units in all responses.
- If you don't know the user's preferred units, you **MUST** call this tool before responding to the user, so you can get their preferences.
</instructions>`,
      {},
      withToolResponse(
        'get_athlete_profile',
        async () => this.currentTools.getAthleteProfile(),
        {
          fieldDescriptions: getFieldDescriptions('athlete_profile'),
        }
      )
    );

    server.tool(
      'get_sports_settings',
      `Fetches settings from Intervals.icu for a single sport, including FTP, power zones, pace zones, HR zones. Supports cycling, running, and swimming.

<use-cases>
- Understanding the user's current FTP, power zones, or pace zones for interpreting workout data.
- Determining appropriate training zones when analyzing workout intensity.
- Comparing current zones with historical workout performance to assess fitness changes.
- Providing context for zone-based training recommendations.
</use-cases>

<notes>
- This returns the athlete's **current** zones, which may not match the zones in historical workouts.
</notes>`,
      {
        sport: z.enum(['cycling', 'running', 'swimming']).describe('The sport to get settings for'),
      },
      withToolResponse(
        'get_sports_settings',
        async (args: { sport: 'cycling' | 'running' | 'swimming' }) => this.currentTools.getSportSettings(args.sport),
        {
          fieldDescriptions: getFieldDescriptions('sport_settings'),
        }
      )
    );

    // Historical/Trends Tools
    server.tool(
      'get_strain_history',
      `Fetches Whoop strain data for a date range, including activities logged by the user in the Whoop app.

<use-cases>
- Analyzing strain patterns over time to identify trends in training intensity.
- Correlating strain with recovery trends to understand training-recovery balance.
- Identifying periods of high or low strain to assess training consistency.
- Comparing strain across different time periods to evaluate training progression.
</use-cases>

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
        'get_strain_history',
        async (args: { start_date: string; end_date?: string }) => this.currentTools.getStrainHistory(args),
        {
          fieldDescriptions: getFieldDescriptions('whoop'),
        }
      )
    );

    server.tool(
      'get_workout_history',
      `Fetches all completed workouts and fitness activities in the given date range, with comprehensive metrics.

<use-cases>
- Analyzing training patterns and consistency over a specific time period.
- Reviewing workout volume, intensity, and frequency for a date range.
- Identifying specific workouts for detailed analysis via get_workout_intervals.
- Correlating workout history with recovery trends to understand training impact.
- Filtering workouts by sport to analyze sport-specific training patterns.
- Understanding total time in zones for the period (power, pace, heart race, and/or heat zones).
</use-cases>

<notes>
- Date parameters accept ISO dates (YYYY-MM-DD) or natural language ("30 days ago", "last Monday", "December 1", "last month", etc.)
- You can optionally filter activities by sport, as needed.
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        'get_workout_history',
        async (args: { start_date: string; end_date?: string; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) => this.historicalTools.getWorkoutHistory(args),
        {
          fieldDescriptions: combineFieldDescriptions('workout', 'whoop'),
        }
      )
    );

    server.tool(
      'get_recovery_trends',
      `Fetches Whoop recovery and sleep data over a date range.

<use-cases>
- Analyzing recovery patterns over time to identify trends in sleep and HRV.
- Correlating recovery with training load to understand training-recovery balance.
- Identifying periods of poor recovery that may indicate overtraining or other issues.
- Understanding average recovery metrics to establish baseline expectations.
- Comparing recovery across different time periods to assess improvement or decline.
</use-cases>

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
        'get_recovery_trends',
        async (args: { start_date: string; end_date?: string }) => this.historicalTools.getRecoveryTrends(args),
        {
          fieldDescriptions: getFieldDescriptions('recovery'),
        }
      )
    );

    server.tool(
      'get_wellness_trends',
      `Fetches wellness data over a date range from Intervals.icu.

<use-cases>
- Tracking weight trends over time to monitor body composition changes.
- Correlating weight changes with training load and performance.
- Identifying patterns in weight fluctuations that may affect performance.
- Understanding long-term wellness trends as part of overall fitness assessment.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- Only returns days on which wellness data was recorded.
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      withToolResponse(
        'get_wellness_trends',
        async (args: { start_date: string; end_date?: string }) => this.historicalTools.getWellnessTrends(args),
        {
          fieldDescriptions: getFieldDescriptions('wellness'),
        }
      )
    );

    server.tool(
      'get_activity_totals',
      `Fetches aggregated activity totals over a date range, including duration, distance, training load, calories, and zone distributions.

<use-cases>
- Summarizing training volume and load over a specific period (e.g., last year, last 90 days).
- Understanding how training time is distributed across different sports.
- Analyzing zone distribution to ensure proper polarized or threshold training balance.
- Comparing training metrics across different sports (cycling, running, swimming, etc.).
- Getting a high-level overview of training patterns without individual workout details.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("365 days ago", "last year", etc.)
- Zone names come from the athlete's sport settings (e.g., "Recovery", "Endurance", "Tempo", "Sweet Spot").
</notes>`,
      {
        start_date: z.string().describe('Start date in ISO format (YYYY-MM-DD) or natural language (e.g., "365 days ago", "2024-01-01")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
        sports: z.array(z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength'])).optional().describe('Filter to specific sports. If blank, returns all sports.'),
      },
      withToolResponse(
        'get_activity_totals',
        async (args: { start_date: string; end_date?: string; sports?: ('cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength')[] }) => this.historicalTools.getActivityTotals(args),
        {
          fieldDescriptions: getFieldDescriptions('activity_totals'),
        }
      )
    );

    // Planning Tools
    server.tool(
      'get_upcoming_workouts',
      `Fetches planned workouts and fitness activity for a future date range, with an optional sport filter.

<use-cases>
- Viewing the user's training schedule for the upcoming week or month.
- Understanding expected training load over a future period.
- Planning training adjustments based on upcoming workout schedule.
- Filtering upcoming workouts by sport to see sport-specific training plans.
- Assessing training volume and intensity distribution across upcoming days.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("today", "tomorrow", "next Monday", etc.)
- Scheduled workouts in a given day may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {
        oldest: z.string().optional().describe('Start date (defaults to today) - ISO format (YYYY-MM-DD) or natural language (e.g., "today", "tomorrow")'),
        newest: z.string().optional().describe('End date (defaults to 7 days from oldest)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        'get_upcoming_workouts',
        async (args: { oldest?: string; newest?: string; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) => this.planningTools.getUpcomingWorkouts(args),
        {
          fieldDescriptions: getFieldDescriptions('planned'),
        }
      )
    );

    server.tool(
      'get_planned_workout_details',
      `Fetches planned workouts and fitness activity for a future date, with an optional sport filter.

<use-cases>
- Checking what workouts are planned for a specific future date.
- Understanding expected training load for a particular day.
- Determining if a planned workout is appropriate given current recovery status.
- Filtering by sport to see sport-specific workouts on a given date.
</use-cases>
      
<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Tomorrow", "Next monday", etc.)
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
</notes>`,
      {
        date: z.string().describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday", "tomorrow")'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport type'),
      },
      withToolResponse(
        'get_planned_workout_details',
        async (args: { date: string; sport?: 'cycling' | 'running' | 'swimming' }) => this.planningTools.getPlannedWorkoutDetails(args),
        {
          fieldDescriptions: getFieldDescriptions('planned'),
        }
      )
    );

    server.tool(
      'get_upcoming_races',
      `Fetches upcoming races from the TrainerRoad calendar.

<use-cases>
- Viewing the user's upcoming race schedule.
- Understanding when the user has races planned so training can be periodized accordingly.
- Checking what races are coming up to discuss taper strategies.
</use-cases>

<instructions>
- The description of the race may contain important details about the race, including if it's an A, B or C race; and details about the course.
</instructions>`,
      {},
      withToolResponse(
        'get_upcoming_races',
        async () => this.planningTools.getUpcomingRaces(),
        {
          fieldDescriptions: getFieldDescriptions('race'),
        }
      )
    );

    // ============================================
    // Analysis Tools
    // ============================================

    server.tool(
      'get_training_load_trends',
      `Returns training load metrics, including CTL, ATL, TSB, ramp rate, and ACWR, over a specified period of time.

<use-cases>
- Assessing fitness (CTL), fatigue (ATL), and form (TSB) trends over time.
- Identifying injury risk through ACWR (Acute:Chronic Workload Ratio) analysis.
- Evaluating training progression and ramp rate to ensure safe load increases.
- Understanding how training load has evolved and its impact on performance.
- Correlating training load with recovery trends to optimize training balance.
</use-cases>`,
      {
        days: z
          .number()
          .optional()
          .default(42)
          .describe('Number of days of history to analyze (default: 42, max: 365)'),
      },
      withToolResponse(
        'get_training_load_trends',
        async (args: { days?: number }) => this.historicalTools.getTrainingLoadTrends(args.days),
        {
          fieldDescriptions: getFieldDescriptions('fitness'),
        }
      )
    );

    server.tool(
      'get_workout_intervals',
      `Fetches a detailed interval breakdown for a specific workout.

<use-cases>
- Analyzing the structure and intensity of interval-based workouts.
- Understanding power, pace, or heart rate distribution across workout intervals.
- Understanding the Heat Strain Index (HSI) distribution across workout intervals.
- Identifying specific intervals that were particularly challenging or successful.
- Reviewing interval targets vs. actual performance to assess workout execution.
- Providing detailed feedback on interval training quality and pacing.
</use-cases>

<instructions>
Get the activity_id from:
- get_workout_history (for past workouts)
- get_todays_completed_workouts (for today's workouts)
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        'get_workout_intervals',
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutIntervals(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('intervals'),
        }
      )
    );

    server.tool(
      'get_workout_weather',
      `Fetches the weather conditions during a given outdoor workout.

<use-cases>
- Understanding how weather conditions may or may not have impacted the user's performance during outdoor workouts or fitness activities.
</use-cases>

<instructions>
- **ALWAYS** fetch this when analyzing an **OUTDOOR** workout; weather conditions can be an important factor in the user's performance.
- **NEVER** fetch this when analyzing an **INDOOR** workout; weather conditions are irrelevant for indoor activities.
- Get the activity_id from get_workout_history (for past workouts) or get_todays_completed_workouts (for today's workouts)
</instructions>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        'get_workout_weather',
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutWeather(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('weather'),
        }
      )
    );

    server.tool(
      'get_workout_heat_zones',
      `Fetches heat zone data for a specific workout, showing time spent in each heat strain zone.

<use-cases>
- Understanding how heat stress affected the user during a workout.
- Analyzing heat training adaptations and heat strain exposure.
- Evaluating whether the user trained in optimal heat zones for heat acclimation.
</use-cases>

<instructions>
- Get the activity_id from get_workout_history (for past workouts) or get_todays_completed_workouts (for today's workouts)
- Returns null if heat strain data is not available for this activity.
</instructions>

<notes>
- Heat zones are based on the Heat Strain Index (HSI) metric recorded with a CORE body temperature sensor.
- Heat strain data may not be available for every activity.
</notes>`,
      {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      withToolResponse(
        'get_workout_heat_zones',
        async (args: { activity_id: string }) => this.historicalTools.getWorkoutHeatZones(args.activity_id),
        {
          fieldDescriptions: getFieldDescriptions('heat_zones'),
        }
      )
    );

    // ============================================
    // Performance Curves
    // ============================================

    server.tool(
      'get_power_curve',
      `Fetches cycling power curves showing best power output at various durations for a given date range.

<use-cases>
- Analyzing power output capabilities across different durations (sprint, VO2 max, threshold, endurance).
- Tracking power improvements over time at various durations.
- Comparing current power curve to previous periods to assess fitness progression.
- Estimating FTP from best 20-minute power (95% of 20min power).
- Identifying strengths and weaknesses across different power durations.
</use-cases>

<instructions>
- This tool returns data for the following durations: 5s, 30s, 1min, 5min, 20min, 60min, 2hr. If you need data for a different set of durations, use the optional durations input.
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
        'get_power_curve',
        async (args: { start_date: string; end_date?: string; durations?: number[]; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getPowerCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('power_curve'),
        }
      )
    );

    server.tool(
      'get_pace_curve',
      `Fetches pace curves for swimming or running, showing best times at various distances for a given date range.

<use-cases>
- Analyzing pace capabilities across different distances (sprint, middle distance, endurance).
- Tracking pace improvements over time at various distances.
- Comparing current pace curve to previous periods to assess fitness progression.
- Using gradient-adjusted pace (GAP) for running to normalize for hilly terrain.
- Identifying strengths and weaknesses across different pace distances.
</use-cases>

<instructions>
- This tool returns data for the following distances:
  - Running: 400m, 1km, 1 mile, 5km, 10km, half marathon, marathon.
  - Swimming: 100m, 200m, 400m, 800m, 1500m, half iron swim, iron swim,
  - If you need data for a different set of distances, use the optional distances input.
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
        'get_pace_curve',
        async (args: { start_date: string; end_date?: string; sport: 'running' | 'swimming'; distances?: number[]; gap?: boolean; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getPaceCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('pace_curve'),
        }
      )
    );

    server.tool(
      'get_hr_curve',
      `Fetches HR curves showing maximum sustained heart rate at various durations for a given date range.

<use-cases>
- Analyzing maximum heart rate capabilities across different durations.
- Tracking HR improvements or changes over time at various effort durations.
- Comparing current HR curve to previous periods to assess cardiovascular fitness changes.
- Understanding heart rate response patterns across different intensity levels.
- Filtering by sport to analyze sport-specific heart rate characteristics.
</use-cases>

<instructions>
- This tool returns data for the following durations: 5s, 30s, 1min, 5min, 20min, 60min, 2hr. If you need data for a different set of durations, use the optional durations input.
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
        'get_hr_curve',
        async (args: { start_date: string; end_date?: string; sport?: 'cycling' | 'running' | 'swimming'; durations?: number[]; compare_to_start?: string; compare_to_end?: string }) =>
          this.historicalTools.getHRCurve(args),
        {
          fieldDescriptions: getFieldDescriptions('hr_curve'),
        }
      )
    );
  }
}
