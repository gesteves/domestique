import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { LastFmClient } from '../clients/lastfm.js';
import { GoogleWeatherClient } from '../clients/google-weather.js';
import { GoogleAirQualityClient } from '../clients/google-air-quality.js';
import { GooglePollenClient } from '../clients/google-pollen.js';
import { GoogleElevationClient } from '../clients/google-elevation.js';
import { GoogleGeocodingClient } from '../clients/google-geocoding.js';
import { GoogleTimezoneClient } from '../clients/google-timezone.js';
import { CurrentTools } from './current.js';

// Common annotation presets for tool categories. All four hints are set
// explicitly on every preset so MCP clients (e.g. MCP Inspector) don't fall
// back to spec defaults — the spec defaults destructiveHint=true and
// openWorldHint=true, which would mislabel read-only tools.
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
const CREATES_EXTERNAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const MODIFIES_EXTERNAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';
import * as schemas from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from '../utils/response-builder.js';
import { formatResponseDates } from '../utils/date-formatting.js';
import { type HintGenerator, generateHints } from '../utils/hints.js';
import { runWithUnitPreferences, METRIC_DEFAULTS } from '../utils/unit-context.js';
import type { UnitPreferences } from '../types/index.js';
import {
  trainerroadSyncHint,
  dailySummarySyncHint,
  workoutHistoryHints,
  dailySummaryHints,
  todaysWorkoutsHints,
  powerCurveProgressHint,
  paceCurveProgressHint,
} from '../utils/hints/index.js';
import { ApiError, DateParseError } from '../errors/index.js';
import { logUnexpectedError } from '../utils/logger.js';

interface ResponseOptions<TResult = unknown> {
  /** Optional metadata for ChatGPT widgets (surfaced via _meta, not visible to the model). */
  widgetMeta?: Record<string, unknown>;
  /** Optional hint generators to provide actionable next steps. */
  hints?: HintGenerator<TResult>[];
}

/**
 * Self-contained definition of an MCP tool: metadata, schemas, handler, and
 * response shaping options. The handler must return an object that conforms to
 * outputSchema — that object becomes structuredContent in the tool response per
 * the 2025-11-25 MCP spec.
 */
interface ToolDef<TArgs, TResult> extends ResponseOptions<TResult> {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  handler: (args: TArgs) => Promise<TResult>;
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
function buildErrorResponse(error: unknown, toolName?: string): ErrorResponse {
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
    // Note: API errors are already logged at the client level with full context
    // (response body, URL, status code). Here we just build the response.
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
    // Handle unknown errors - these need logging since they weren't caught at the client level
    logUnexpectedError(error, toolName);
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
 * Formats all date fields in the response to human-readable strings.
 *
 * Also fetches the athlete's unit preferences from Intervals.icu (cached) and
 * runs the handler within an AsyncLocalStorage context so unit-aware formatters
 * emit values in the user's chosen units. A failure to fetch preferences falls
 * back to metric defaults — a one-time profile-read hiccup shouldn't fail tools.
 */
function withToolResponse<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
  options: ResponseOptions<TResult>,
  getTimezone?: () => Promise<string>,
  getUnitPreferences?: () => Promise<UnitPreferences>
): (args: TArgs) => Promise<ToolResponse | ErrorResponse> {
  return async (args: TArgs) => {
    console.log(`[Tool] Calling tool: ${toolName}`);
    let prefs: UnitPreferences = METRIC_DEFAULTS;
    if (getUnitPreferences) {
      try {
        prefs = await getUnitPreferences();
      } catch (error) {
        console.error(`[Tool] Failed to fetch unit preferences for ${toolName}, defaulting to metric:`, error);
      }
    }
    return runWithUnitPreferences(prefs, async () => {
      try {
        const data = await handler(args);

        // Format all date fields to human-readable strings
        const timezone = getTimezone ? await getTimezone() : null;
        const formattedData = timezone ? formatResponseDates(data, timezone) : data;

        // Generate hints from the response data if hint generators are provided
        const hints = options.hints ? generateHints(formattedData as TResult, options.hints) : undefined;

        return await buildToolResponse({
          data: formattedData as Record<string, unknown>,
          widgetMeta: options.widgetMeta,
          hints,
        });
      } catch (error) {
        return buildErrorResponse(error, toolName);
      }
    });
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
  lastfm?: { username: string; apiKey: string } | null;
  googleWeather?: { apiKey: string } | null;
  googleAirQuality?: { apiKey: string } | null;
  googlePollen?: { apiKey: string } | null;
  googleElevation?: { apiKey: string } | null;
  googleGeocoding?: { apiKey: string } | null;
  googleTimezone?: { apiKey: string } | null;
}

export class ToolRegistry {
  private currentTools: CurrentTools;
  private historicalTools: HistoricalTools;
  private planningTools: PlanningTools;
  private intervalsClient: IntervalsClient;
  // Track optional client presence so registerTools can skip tools whose data
  // source isn't connected — better to hide a tool than register one that
  // returns empty results without explanation.
  private readonly hasWhoop: boolean;
  private readonly hasTrainerRoad: boolean;
  private readonly hasLastFm: boolean;
  private readonly hasGoogleWeather: boolean;

  constructor(config: ToolsConfig) {
    const intervalsClient = new IntervalsClient(config.intervals);
    this.intervalsClient = intervalsClient;
    const whoopClient = config.whoop ? new WhoopClient(config.whoop) : null;
    const trainerroadClient = config.trainerroad
      ? new TrainerRoadClient(config.trainerroad)
      : null;
    const lastfmClient = config.lastfm ? new LastFmClient(config.lastfm) : null;
    const googleWeatherClient = config.googleWeather
      ? new GoogleWeatherClient(config.googleWeather)
      : null;
    const googleAirQualityClient = config.googleAirQuality
      ? new GoogleAirQualityClient(config.googleAirQuality)
      : null;
    const googlePollenClient = config.googlePollen
      ? new GooglePollenClient(config.googlePollen)
      : null;
    const googleElevationClient = config.googleElevation
      ? new GoogleElevationClient(config.googleElevation)
      : null;
    const googleGeocodingClient = config.googleGeocoding
      ? new GoogleGeocodingClient(config.googleGeocoding)
      : null;
    const googleTimezoneClient = config.googleTimezone
      ? new GoogleTimezoneClient(config.googleTimezone)
      : null;
    this.hasWhoop = whoopClient !== null;
    this.hasTrainerRoad = trainerroadClient !== null;
    this.hasLastFm = lastfmClient !== null;
    this.hasGoogleWeather = googleWeatherClient !== null;

    // Connect Whoop client to Intervals.icu timezone for proper date filtering
    if (whoopClient) {
      whoopClient.setTimezoneGetter(() => intervalsClient.getAthleteTimezone());
    }

    // Connect Last.fm client to Intervals.icu so normalizeActivity can enrich workouts
    // with played songs when skipExpensiveCalls is false.
    if (lastfmClient) {
      intervalsClient.setPlayedSongsGetter((startMs, endMs) =>
        lastfmClient.getPlayedSongsDuring(startMs, endMs)
      );
    }

    this.currentTools = new CurrentTools(
      intervalsClient,
      whoopClient,
      trainerroadClient,
      googleWeatherClient,
      googleAirQualityClient,
      googlePollenClient,
      googleElevationClient,
      googleGeocodingClient,
      googleTimezoneClient
    );
    this.historicalTools = new HistoricalTools(intervalsClient, whoopClient, lastfmClient);
    this.planningTools = new PlanningTools(intervalsClient, trainerroadClient);
  }

  /**
   * Register a single tool, applying shared response/error scaffolding.
   * Centralizes wiring of: tool name (used twice), input/output schema, response
   * wrapper (date formatting, hints, error handling).
   */
  private registerTool<TArgs, TResult>(
    server: McpServer,
    getTimezone: () => Promise<string>,
    getUnitPreferences: () => Promise<UnitPreferences>,
    def: ToolDef<TArgs, TResult>
  ): void {
    const wrapped = withToolResponse(
      def.name,
      def.handler,
      {
        hints: def.hints,
        widgetMeta: def.widgetMeta,
      },
      getTimezone,
      getUnitPreferences
    );
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        annotations: def.annotations,
      },
      // The SDK expects args typed as the Zod shape's inferred output, but our
      // generic TArgs comes from the handler's explicit annotation. The runtime
      // shapes match by construction; TS can't prove it at this boundary.
      wrapped as Parameters<typeof server.registerTool>[2]
    );
  }

  /**
   * Register all tools with the MCP server
   */
  registerTools(server: McpServer): void {
    const getTimezone = () => this.intervalsClient.getAthleteTimezone();
    const getUnitPreferences = () => this.intervalsClient.getUnitPreferences();
    const register = <TArgs, TResult>(def: ToolDef<TArgs, TResult>): void =>
      this.registerTool(server, getTimezone, getUnitPreferences, def);
    // Today's Summary (most likely to be called first)
    register({
      name: 'get_todays_summary',
      title: "Today's Summary",
      description: `Fetches a complete snapshot of the user's current status today in a single call. This is the tool to call to get all of "today's" data.

**Includes:**
- Whoop recovery, sleep performance, and strain (including HRV, sleep stages, and strain score)
- Fitness metrics: CTL (fitness), ATL (fatigue), TSB (form), plus today's training load
- Wellness metrics, such as vitals and subjective status
- All workouts and fitness activities completed so far today (with matched Whoop strain data)
- All workouts and fitness activities scheduled for today (from both TrainerRoad and Intervals.icu)
- Today's scheduled race, if any

<use-cases>
- Getting today's recovery and readiness data (recovery score, HRV, sleep quality/duration)
- Checking today's accumulated strain and stress
- Reviewing completed workouts and their metrics
- Viewing planned/scheduled workouts for today
- Assessing readiness for training by combining recovery, fitness, and planned workouts
- Understanding the balance between completed and planned training load
- Providing a complete daily status report in a single call
</use-cases>

<instructions>
- **ALWAYS** use this tool when you need any "today's" data: recovery, sleep, strain, completed workouts, or planned workouts.
- Metrics and activities (completed and scheduled) can change over the course of the day; agents are encouraged to call this tool as the day progresses to get up-to-the-minute data rather than rely on the results of a previous call.
</instructions>

<notes>
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      inputSchema: {},
      outputSchema: schemas.todaysSummaryOutputSchema,
      annotations: READ_ONLY,
      handler: async () => this.currentTools.getTodaysSummary(),
      hints: [dailySummarySyncHint, ...dailySummaryHints],
    });

    if (this.hasGoogleWeather) {
      register({
        name: 'get_weather_forecast',
        title: 'Weather Forecast',
        description: `Fetches a weather forecast for a date and (optionally) a location. Supports up to 10 days from today.

**Includes (per location):**
- Location label, coordinates, and elevation
- The forecast date
- Daily summary: high/low temperatures, peak heat index, conditions, precipitation, thunderstorm probability, wind, humidity, UV, cloud cover, and sun/moon events (sunrise, sunset, moonrise, moonset, lunar phase)
- Hourly forecast — remaining hours of the day when the date is today, all 24 hours otherwise. Includes wet-bulb temperature for heat-stress assessment; each hour may include local AQI
- Pollen forecast (Universal Pollen Index level with pollen types, plants, and health recommendations) when available for the date
- When the date is today: current conditions and active weather alerts (warnings, watches, advisories)

<use-cases>
- Deciding whether to ride/run outside today (no args).
- Picking a workout window based on temperature, precipitation, wind, or air quality.
- Race-week planning: forecast for an upcoming race location 1–10 days out.
- Surfacing safety-relevant weather alerts for today (heat, cold, wind, storms, flooding).
- Adjusting fueling, hydration, gear, and pacing for hot or cold conditions on race day.
- Adjusting training intensity based on air quality (AQI band, dominant pollutant).
- Flagging pollen exposure for athletes with seasonal allergies.
</use-cases>

<instructions>
- For "today's weather" with no other "today" data, call this tool with no arguments. For a complete daily snapshot that already includes today's forecast, prefer get_todays_summary.
- For a future date or a specific location, pass \`date\` and/or \`location\`. Date input accepts ISO YYYY-MM-DD or natural-language strings (e.g., "tomorrow", "in 3 days").
- \`location\` can be as broad or as narrow as needed: a city ("San Francisco, CA"), a postal code ("83001"), a neighborhood ("Presidio, San Francisco, CA"), a specific landmark or venue ("Coeur d'Alene City Park, Coeur d'Alene, ID"), or even an exact address ("123 Main Street, San Francisco, CA"). Prefer the most specific form available — narrow it down to the actual race start when known so the forecast reflects that exact spot's microclimate.
</instructions>

<notes>
- Pollen and hourly air quality may be absent for dates further out; they have shorter forecast windows than the daily/hourly weather.
- Current conditions and active alerts are included only when the date is today.
</notes>`,
        inputSchema: schemas.forecastInputSchema,
        outputSchema: schemas.forecastOutputSchema,
        annotations: READ_ONLY,
        handler: async (args: { date?: string; location?: string }) => this.currentTools.getWeatherForecast(args),
      });
    }

    register({
      name: 'get_todays_workouts',
      title: "Today's Workouts",
      description: `Fetches today's workouts only — both completed (with full per-activity details) and planned. A leaner alternative to get_todays_summary when you only need workout data and don't need recovery, sleep, strain, fitness, wellness, or race information.

**Includes:**
- All workouts and fitness activities completed so far today, with full details (intervals, notes, weather, zones, heat zones, music) and matched Whoop strain data
- All workouts and fitness activities scheduled for today (from both TrainerRoad and Intervals.icu)

<use-cases>
- Quickly checking what the user has done and has planned for today without the overhead of recovery/wellness data.
- Reviewing completed workouts with full detail in a single call (no need to follow up with get_workout_details).
- Viewing today's planned workouts to assess remaining training load.
</use-cases>

<instructions>
- Use this tool when the user only asks about today's workouts (completed or planned) and not about recovery, sleep, strain, or fitness metrics. For a complete daily snapshot, use get_todays_summary instead.
- Workouts (completed and scheduled) can change over the course of the day; call this tool again as the day progresses rather than relying on a previous call's results.
</instructions>

<notes>
- Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      inputSchema: {},
      outputSchema: schemas.todaysWorkoutsOutputSchema,
      annotations: READ_ONLY,
      handler: async () => this.currentTools.getTodaysWorkouts(),
      hints: todaysWorkoutsHints,
    });

    // Profile and Settings (needed early for context)
    register({
      name: 'get_athlete_profile',
      title: 'Athlete Profile',
      description: `Returns the athlete's profile from Intervals.icu including name, location, timezone, gender, date of birth, and age.

<use-cases>
- Fetching the user's name, which may be useful to identify the user's notes from a workout.
- Fetching the user's age, which may be important to interpret their fitness and performance trends over time.
</use-cases>

<notes>
- Domestique formats every unit-bearing field server-side per the athlete's Intervals.icu settings. Values arrive ready to use — do not re-convert them unless asked to.
</notes>`,
      inputSchema: {},
      outputSchema: schemas.athleteProfileOutputSchema,
      annotations: READ_ONLY,
      handler: async () => this.currentTools.getAthleteProfile(),
    });

    register({
      name: 'get_sports_settings',
      title: 'Sport Settings',
      description: `Fetches settings from Intervals.icu for a single sport, including FTP, power zones, pace zones, HR zones. Supports cycling, running, and swimming.

<use-cases>
- Understanding the user's current FTP, power zones, or pace zones for interpreting workout data.
- Determining appropriate training zones when analyzing workout intensity.
- Comparing current zones with historical workout performance to assess fitness changes.
- Providing context for zone-based training recommendations.
</use-cases>

<notes>
- This returns the athlete's **current** zones, which may not match the zones in historical workouts.
</notes>`,
      inputSchema: {
        sport: z.enum(['cycling', 'running', 'swimming']).describe('The sport to get settings for'),
      },
      outputSchema: schemas.sportSettingsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { sport: 'cycling' | 'running' | 'swimming' }) => {
        const result = await this.currentTools.getSportSettings(args.sport);
        return result ?? { sport: args.sport, types: [], settings: {} };
      },
    });

    // Historical/Trends Tools
    if (this.hasWhoop) {
      register({
        name: 'get_strain_history',
        title: 'Strain History',
        description: `Fetches Whoop strain data for a date range, including activities logged by the user in the Whoop app.

<use-cases>
- Analyzing strain patterns over time to identify trends in training intensity.
- Correlating strain with recovery trends to understand training-recovery balance.
- Identifying periods of high or low strain to assess training consistency.
- Comparing strain across different time periods to evaluate training progression.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- If you only need today's strain data, use get_todays_summary instead.
</notes>`,
        inputSchema: {
          oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
          newest: z.string().optional().describe('End date (defaults to today)'),
        },
        outputSchema: schemas.strainHistoryOutputSchema,
        annotations: READ_ONLY,
        handler: async (args: { oldest: string; newest?: string }) => ({
          strain: await this.currentTools.getStrainHistory(args),
        }),
      });
    }

    register({
      name: 'get_workout_history',
      title: 'Workout History',
      description: `Fetches all completed workouts and fitness activities in the given date range, with comprehensive metrics.

<use-cases>
- Analyzing training patterns and consistency over a specific time period in the past.
- Reviewing workout volume, intensity, and frequency for a date range.
- Identifying specific workouts for detailed analysis via get_workout_intervals.
- Correlating workout history with recovery trends to understand training impact.
- Filtering workouts by sport to analyze sport-specific training patterns.
- Understanding total time in zones for the period (power, pace, heart rate, and/or heat zones).
</use-cases>

<notes>
- **NEVER** use this tool to get workouts for the current day; use get_todays_summary for that. This tool is for historical data, not the current day. Passing today's date as either oldest or newest will return an error.
- Date parameters accept ISO dates (YYYY-MM-DD) or natural language ("30 days ago", "last Monday", "December 1", "last month", etc.)
- You can optionally filter activities by sport, as needed.
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed via get_workout_intervals or any of the other analysis tools.
</notes>`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago"). Cannot be today.'),
        newest: z.string().optional().describe('End date (defaults to yesterday). Cannot be today.'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      outputSchema: schemas.workoutHistoryOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) => ({
        workouts: await this.historicalTools.getWorkoutHistory(args),
      }),
      hints: workoutHistoryHints,
    });

    register({
      name: 'get_workout_details',
      title: 'Workout Details',
      description: `Fetches the details of a single completed workout by its activity ID.

<use-cases>
- Getting all available metrics for a specific workout in one call
</use-cases>

<instructions>
Get the activity_id from:
- get_workout_history (for past workouts)
- get_todays_summary or get_todays_workouts (for today's workouts)
</instructions>

<notes>
- This returns more detailed data than what's included in get_workout_history results.
- Includes athlete notes, detailed intervals, weather during the activity (if available), power zones, pace zones, heart rate zones, heat zones, and matched Whoop strain data (if available).
- Workouts imported from Strava are unavailable due to Strava API Agreement restrictions.
</notes>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      outputSchema: schemas.workoutDetailsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { activity_id: string }) => ({
        workout: await this.historicalTools.getWorkoutDetails(args.activity_id),
      }),
    });

    if (this.hasWhoop) {
      register({
        name: 'get_recovery_trends',
        title: 'Recovery Trends',
        description: `Fetches Whoop recovery and sleep data over a date range.

<use-cases>
- Analyzing recovery patterns over time to identify trends in sleep and HRV.
- Correlating recovery with training load to understand training-recovery balance.
- Identifying periods of poor recovery that may indicate overtraining or other issues.
- Understanding average recovery metrics to establish baseline expectations.
- Comparing recovery across different time periods to assess improvement or decline.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- If you only need today's recovery and sleep data, use get_todays_summary instead.
</notes>`,
        inputSchema: {
          oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
          newest: z.string().optional().describe('End date (defaults to today)'),
        },
        outputSchema: schemas.recoveryTrendsOutputSchema,
        annotations: READ_ONLY,
        handler: async (args: { oldest: string; newest?: string }) =>
          this.historicalTools.getRecoveryTrends(args),
      });
    }

    register({
      name: 'get_wellness_trends',
      title: 'Wellness Trends',
      description: `Fetches daily wellness data over a date range from Intervals.icu — every metric the athlete has recorded, regardless of source.

<use-cases>
- Tracking HRV (rMSSD and SDNN), resting HR, and sleep (duration/score/quality/avg HR) trends to spot recovery patterns.
- Monitoring SpO2, blood pressure, respiration, and other vitals over time.
- Following body composition (weight, body fat, abdomen, VO2max) changes alongside training load.
- Reviewing subjective scores (mood, fatigue, soreness, stress, motivation, injury, hydration) to correlate with performance.
- Watching nutrition (kcal, carbs, protein, fat) and step count.
- **Cross-source comparison:** when Whoop is also connected, the same metric (HRV, RHR, SpO2, sleep, etc.) often appears in both Intervals.icu wellness (typically fed from Garmin/Oura/manual) and Whoop. Each present field carries an entry in the per-day \`sources\` map naming its configured provider, so you can compare the readings and reconcile differences between platforms.
</use-cases>

<notes>
- Date parameters accept ISO format (YYYY-MM-DD) or natural language ("Yesterday", "7 days ago", "last week", "2 weeks ago", etc.)
- Only returns days on which wellness data was recorded.
- The \`sources\` map is inferred from the athlete's per-provider wellness key configuration in Intervals.icu, not stamped on each record. Manually entered values may still show a configured source.
</notes>`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
      },
      outputSchema: schemas.wellnessTrendsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string }) =>
        this.historicalTools.getWellnessTrends(args),
    });

    register({
      name: 'get_activity_totals',
      title: 'Activity Totals',
      description: `Fetches aggregated activity totals over a date range, including duration, distance, training load, calories, and zone distributions.

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
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
        sports: z.array(z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength'])).optional().describe('Filter to specific sports. If blank, returns all sports.'),
      },
      outputSchema: schemas.activityTotalsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string; sports?: ('cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength')[] }) =>
        this.historicalTools.getActivityTotals(args),
    });

    // Planning Tools
    register({
      name: 'get_upcoming_workouts',
      title: 'Upcoming Workouts',
      description: `Fetches planned workouts and fitness activity for a future date range, with an optional sport filter.

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
      inputSchema: {
        oldest: z.string().optional().describe('Start date (defaults to today; e.g., "2024-01-01", "tomorrow")'),
        newest: z.string().optional().describe('End date (defaults to 7 days from start)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      outputSchema: schemas.upcomingWorkoutsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest?: string; newest?: string; sport?: 'cycling' | 'running' | 'swimming' | 'skiing' | 'hiking' | 'rowing' | 'strength' }) =>
        this.planningTools.getUpcomingWorkouts(args),
      hints: [trainerroadSyncHint],
    });

    if (this.hasTrainerRoad) {
      register({
        name: 'get_upcoming_races',
        title: 'Upcoming Races',
        description: `Fetches upcoming races from the TrainerRoad calendar.

<use-cases>
- Viewing the user's upcoming race schedule.
- Understanding when the user has races planned so training can be periodized accordingly.
- Checking what races are coming up to discuss taper strategies.
</use-cases>

<instructions>
- The description of the race may contain important details about the race, including if it's an A, B or C race; and details about the course.
</instructions>`,
        inputSchema: {},
        outputSchema: schemas.upcomingRacesOutputSchema,
        annotations: READ_ONLY,
        handler: async () => ({
          races: await this.planningTools.getUpcomingRaces(),
        }),
      });
    }

    // ============================================
    // Workout Sync Tools
    // ============================================

    register({
      name: 'create_workout',
      title: 'Create Workout',
      description: `Creates a structured workout in Intervals.icu. Cycling and running workouts sync to Zwift and Garmin.

<use-cases>
- Creating a structured workout in Intervals.icu from a workout_doc written in Intervals.icu syntax.
- Syncing run workouts from TrainerRoad to be executable on Zwift or Garmin.
</use-cases>

<instructions>
- The workout_doc parameter must contain a valid Intervals.icu workout definition. The caller is responsible for generating the correct syntax.
- If syncing a TrainerRoad run, set sport to "running" and include the trainerroad_uid, which enables orphan tracking. trainerroad_uid is ignored for other sports.
</instructions>

<notes>
- This creates the workout directly in Intervals.icu and will appear on the user's calendar.
- The workout will be tagged with 'domestique' for tracking.
- If the workout looks wrong after creation, use delete_workout to remove it and recreate with fixes.
</notes>`,
      inputSchema: {
        sport: z.enum(['cycling', 'running', 'swimming']).describe('Sport for the workout'),
        scheduled_for: z.string().describe('Date (YYYY-MM-DD) or datetime for the workout'),
        name: z.string().describe('Workout name'),
        description: z.string().optional().describe('Optional notes/description'),
        workout_doc: z.string().describe('Structured workout in Intervals.icu syntax'),
        trainerroad_uid: z.string().optional().describe('TrainerRoad workout UID for orphan tracking. Only meaningful when sport is "running"'),
      },
      outputSchema: schemas.createWorkoutOutputSchema,
      annotations: CREATES_EXTERNAL,
      handler: async (args: { sport: 'cycling' | 'running' | 'swimming'; scheduled_for: string; name: string; description?: string; workout_doc: string; trainerroad_uid?: string }) =>
        this.planningTools.createWorkout(args),
    });

    register({
      name: 'delete_workout',
      title: 'Delete Workout',
      description: `Deletes a Domestique-created workout from Intervals.icu.

<use-cases>
- Removing orphaned workouts when TrainerRoad plans change.
- Deleting incorrectly synced workouts before recreating with fixes.
- Cleaning up test workouts.
</use-cases>

<instructions>
- Only works on workouts tagged with 'domestique' (i.e. created by Domestique).
- Use this to remove incorrect workouts before recreating with fixes.
- Get the event_id from get_upcoming_workouts, get_todays_summary, or get_todays_workouts.
</instructions>

<notes>
- This permanently deletes the workout from Intervals.icu.
- Cannot delete workouts not created by Domestique.
</notes>`,
      inputSchema: {
        event_id: z.string().describe('Intervals.icu event ID to delete'),
      },
      outputSchema: schemas.deleteWorkoutOutputSchema,
      annotations: DESTRUCTIVE,
      handler: async (args: { event_id: string }) =>
        this.planningTools.deleteWorkout(args.event_id),
    });

    register({
      name: 'update_workout',
      title: 'Update Workout',
      description: `Updates a Domestique-created workout in Intervals.icu.

<use-cases>
- Modifying the name or description of a synced workout.
- Changing the scheduled date of a workout.
- Updating the structured workout definition (workout_doc).
</use-cases>

<instructions>
- Only works on workouts tagged with 'domestique' (i.e. created by Domestique).
- Get the event_id from get_upcoming_workouts, get_todays_summary, or get_todays_workouts.
- Only provide the fields you want to update; omitted fields remain unchanged.
</instructions>

<notes>
- The 'domestique' tag is automatically preserved.
- Changing the type (e.g., Run to Ride) without updating workout_doc may result in invalid syntax.
- Cannot update workouts not created by Domestique.
</notes>`,
      inputSchema: {
        event_id: z.string().describe('Intervals.icu event ID to update'),
        name: z.string().optional().describe('New workout name'),
        description: z.string().optional().describe('New description/notes'),
        workout_doc: z.string().optional().describe('New structured workout in Intervals.icu syntax'),
        scheduled_for: z.string().optional().describe('New date (YYYY-MM-DD) or datetime'),
        type: z.string().optional().describe('New event type (e.g., "Run", "Ride")'),
      },
      outputSchema: schemas.updateWorkoutOutputSchema,
      annotations: MODIFIES_EXTERNAL,
      handler: async (args: { event_id: string; name?: string; description?: string; workout_doc?: string; scheduled_for?: string; type?: string }) =>
        this.planningTools.updateWorkout(args),
    });

    if (this.hasTrainerRoad) {
      register({
        name: 'sync_trainerroad_runs',
        title: 'Sync TrainerRoad Runs',
        description: `Syncs TrainerRoad running workouts to Intervals.icu.

<use-cases>
- Bulk syncing all TrainerRoad runs for a date range to Intervals.icu.
- Detecting and cleaning up orphaned workouts when TrainerRoad plans change.
- Initial setup of TrainerRoad run sync.
</use-cases>

<instructions>
1. Call this tool to get the list of TR runs that need syncing.
2. For each TrainerRoad run in runs_to_sync, use create_workout (sport: "running") to create it.
3. Orphaned workouts (i.e the TrainerRoad source workout got deleted) are automatically removed.
</instructions>

<notes>
- Only syncs running workouts (not cycling or swimming).
- Created workouts are tagged with 'domestique' for tracking.
- The runs_to_sync array contains TR runs that need to be converted and created.
</notes>`,
        inputSchema: {
          oldest: z.string().optional().describe('Start date (defaults to today)'),
          newest: z.string().optional().describe('End date (defaults to 30 days from start)'),
        },
        outputSchema: schemas.syncTrainerRoadRunsOutputSchema,
        // Can be destructive (deletes orphans), but also creates external resources
        annotations: DESTRUCTIVE,
        handler: async (args: { oldest?: string; newest?: string }) =>
          this.planningTools.syncTRRuns(args),
      });
    }

    register({
      name: 'set_workout_intervals',
      title: 'Set Workout Intervals',
      description: `Sets intervals on a completed activity in Intervals.icu.

<use-cases>
- Matching completed workout intervals to a TrainerRoad workout structure.
- Defining custom interval boundaries on a completed workout.
- Re-analyzing a workout with corrected interval timing.
</use-cases>

<instructions>
1. Determine the interval data from the information given by the user:
   - Extract start time, end time, and an optional label for each interval
   - You may need to convert timestamps to seconds (e.g., "0:05:00" = 300 seconds, "1:15:00" = 4500 seconds)
2. Determine WORK vs RECOVERY type using the power_zones embedded in the workout:
   - Generally speaking, Zone 1 is RECOVERY, and anything else is WORK
   - That said, use your best judgement: A Zone 2 interval after a Zone 4 or 5 interval could reasonably be considered a RECOVERY interval
3. Call this tool with the activity_id and parsed intervals array.
4. Set the replace_existing_intervals, as needed, depending on the user's instructions
</instructions>

<notes>
- By default, all existing intervals on the activity will be replaced.
- Set replace_existing_intervals to false to merge new intervals with existing ones.
- Intervals.icu will recalculate all metrics (power, HR, cadence, TSS, etc.) from the recorded activity data.
- Times are in seconds from the start of the activity.
- Use the workout's power_zones (not current athlete sport settings) for type inference, as FTP may have changed since the workout.
</notes>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID'),
        intervals: z
          .array(
            z.object({
              start_time: z.number().describe('Start time in seconds from activity start'),
              end_time: z.number().describe('End time in seconds from activity start'),
              type: z.enum(['WORK', 'RECOVERY']).describe('Interval type based on power zone'),
              label: z.string().optional().describe('Optional interval label (e.g., "Warmup", "Interval 1")'),
            })
          )
          .describe('Array of intervals to set on the activity'),
        replace_existing_intervals: z
          .boolean()
          .optional()
          .describe('Whether to replace all existing intervals (true, default) or merge with existing (false)'),
      },
      outputSchema: schemas.setWorkoutIntervalsOutputSchema,
      annotations: MODIFIES_EXTERNAL,
      handler: async (args: {
        activity_id: string;
        intervals: Array<{
          start_time: number;
          end_time: number;
          type: 'WORK' | 'RECOVERY';
          label?: string;
        }>;
        replace_existing_intervals?: boolean;
      }) => this.planningTools.setWorkoutIntervals(args),
    });

    register({
      name: 'update_activity',
      title: 'Update Activity',
      description: `Updates the name and/or description of a completed activity in Intervals.icu.

<use-cases>
- Renaming a completed workout to something more descriptive or memorable.
- Adding or editing a description or notes on a completed workout.
- Correcting the auto-generated name of a recorded activity.
</use-cases>

<instructions>
Get the activity_id from:
- get_workout_history (for past workouts)
- get_todays_summary or get_todays_workouts (for today's workouts)
- get_workout_details (for a specific workout)
Only provide the fields you want to update; omitted fields remain unchanged.
</instructions>

<notes>
- This updates completed/recorded activities, not planned workouts on the calendar. To update planned workouts, use update_workout instead.
- At least one of name or description must be provided.
</notes>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID'),
        name: z.string().optional().describe('New name for the activity'),
        description: z.string().optional().describe('New description/notes for the activity'),
      },
      outputSchema: schemas.updateActivityOutputSchema,
      annotations: MODIFIES_EXTERNAL,
      handler: async (args: { activity_id: string; name?: string; description?: string }) =>
        this.planningTools.updateActivity(args),
    });

    // ============================================
    // Analysis Tools
    // ============================================

    register({
      name: 'get_training_load_trends',
      title: 'Training Load Trends',
      description: `Returns training load metrics, including CTL, ATL, TSB, ramp rate, and ACWR, over a specified period of time.

<use-cases>
- Assessing fitness (CTL), fatigue (ATL), and form (TSB) trends over time.
- Identifying injury risk through ACWR (Acute:Chronic Workload Ratio) analysis.
- Evaluating training progression and ramp rate to ensure safe load increases.
- Understanding how training load has evolved and its impact on performance.
- Correlating training load with recovery trends to optimize training balance.
</use-cases>`,
      inputSchema: {
        days: z
          .number()
          .optional()
          .default(42)
          .describe('Number of days of history to analyze (default: 42, max: 365)'),
      },
      outputSchema: schemas.trainingLoadTrendsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { days?: number }) =>
        this.historicalTools.getTrainingLoadTrends(args.days),
    });

    register({
      name: 'get_workout_intervals',
      title: 'Workout Intervals',
      description: `Fetches a detailed interval breakdown for a specific workout.

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
- get_todays_workouts (for today's workouts)
</instructions>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      outputSchema: schemas.workoutIntervalsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { activity_id: string }) =>
        this.historicalTools.getWorkoutIntervals(args.activity_id),
    });

    register({
      name: 'get_workout_notes',
      title: 'Workout Notes',
      description: `Fetches notes attached to a specific workout, which may be comments made by the user, or other Intervals.icu users, like a coach.

<use-cases>
- Understanding how the user may have subjectively felt during a workout, and anything else not captured by objective fitness metrics.
- Reading feedback left by other Intervals.icu users, which could be a coach or a follower.
</use-cases>

<instructions>
- Get the activity_id from get_workout_history.
- Make sure to fetch attachments and follow links left in the notes.
- Make sure to identify which comments are coming from the user when interpreting the data. Ask the user for clarification if there are comments left by other people.
</instructions>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      outputSchema: schemas.workoutNotesOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { activity_id: string }) =>
        this.historicalTools.getWorkoutNotes(args.activity_id),
    });

    register({
      name: 'get_workout_weather',
      title: 'Workout Weather',
      description: `Fetches the weather conditions during a given outdoor workout.

<use-cases>
- Understanding how weather conditions may or may not have impacted the user's performance during outdoor workouts or fitness activities.
</use-cases>

<instructions>
- For past workouts, get the activity_id from get_workout_history. For today's workouts, get the activity_id from get_todays_summary or get_todays_workouts.
</instructions>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      outputSchema: schemas.workoutWeatherOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { activity_id: string }) =>
        this.historicalTools.getWorkoutWeather(args.activity_id),
    });

    register({
      name: 'get_workout_heat_zones',
      title: 'Workout Heat Zones',
      description: `Fetches heat zone data for a specific workout, showing time spent in each heat strain zone.

<use-cases>
- Understanding how heat stress affected the user during a workout.
- Analyzing heat training adaptations and heat strain exposure.
- Evaluating whether the user trained in optimal heat zones for heat acclimation.
</use-cases>

<instructions>
- Get the activity_id from get_workout_history (for past workouts) or get_todays_summary or get_todays_workouts (for today's workouts).
- Returns null if heat strain data is not available for this activity.
</instructions>

<notes>
- Heat zones are based on the Heat Strain Index (HSI) metric recorded with a CORE body temperature sensor.
- Heat strain data may not be available for every activity.
</notes>`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
      },
      outputSchema: schemas.workoutHeatZonesOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { activity_id: string }) =>
        this.historicalTools.getWorkoutHeatZones(args.activity_id),
    });

    if (this.hasLastFm) {
      register({
        name: 'get_workout_music',
        title: 'Workout Music',
        description: `Fetches songs scrobbled to Last.fm during a specific workout, in chronological order.

<use-cases>
- Reviewing what music the user listened to during a workout.
- Correlating music choices with workout intensity or perceived effort.
</use-cases>

<instructions>
- Get the activity_id from get_workout_history (for past workouts) or get_todays_summary or get_todays_workouts (for today's workouts).
- Returns an empty array if no scrobbles fall within the activity's time window.
</instructions>`,
        inputSchema: {
          activity_id: z.string().describe('Intervals.icu activity ID (e.g., "i111325719")'),
        },
        outputSchema: schemas.workoutMusicOutputSchema,
        annotations: READ_ONLY,
        handler: async (args: { activity_id: string }) =>
          this.historicalTools.getWorkoutMusic(args.activity_id),
      });
    }

    // ============================================
    // Performance Curves
    // ============================================

    register({
      name: 'get_power_curve',
      title: 'Power Curve',
      description: `Fetches cycling power curves showing best power output at various durations for a given date range.

<use-cases>
- Analyzing power output capabilities across different durations (sprint, VO2 max, threshold, endurance).
- Tracking power improvements over time at various durations.
- Comparing current power curve to previous periods to assess fitness progression.
- Estimating FTP from best 20-minute power (95% of 20min power).
- Identifying strengths and weaknesses across different power durations.
</use-cases>

<instructions>
- This tool returns data for the following durations: 5s, 30s, 1min, 5min, 20min, 60min, 2hr. If you need data for a different set of durations, use the optional durations input.
- Optional: Use compare_to_oldest and compare_to_newest if you need to compare changes to a previous period.
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
        durations: z.array(z.number()).optional().describe('Custom durations in seconds (e.g., [5, 60, 300, 1200, 7200])'),
        compare_to_oldest: z.string().optional().describe('Comparison period start date (e.g., "2024-01-01", "90 days ago")'),
        compare_to_newest: z.string().optional().describe('Comparison period end date'),
      },
      outputSchema: schemas.powerCurveOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string; durations?: number[]; compare_to_oldest?: string; compare_to_newest?: string }) =>
        this.historicalTools.getPowerCurve(args),
      hints: [powerCurveProgressHint],
    });

    register({
      name: 'get_pace_curve',
      title: 'Pace Curve',
      description: `Fetches pace curves for swimming or running, showing best times at various distances for a given date range.

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
- Optional: Use compare_to_oldest and compare_to_newest if you need to compare changes to a previous period
- Optional: Use the GAP setting to use gradient-adjusted pace, which normalizes for hills (only applicable for running)
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['running', 'swimming']).describe('Sport to analyze'),
        distances: z.array(z.number()).optional().describe('Custom distances in meters (e.g., [400, 1000, 5000])'),
        gap: z.boolean().optional().describe('Use gradient-adjusted pace for running (normalizes for hills)'),
        compare_to_oldest: z.string().optional().describe('Comparison period start date (e.g., "2024-01-01", "90 days ago")'),
        compare_to_newest: z.string().optional().describe('Comparison period end date'),
      },
      outputSchema: schemas.paceCurveOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string; sport: 'running' | 'swimming'; distances?: number[]; gap?: boolean; compare_to_oldest?: string; compare_to_newest?: string }) =>
        this.historicalTools.getPaceCurve(args),
      hints: [paceCurveProgressHint],
    });

    register({
      name: 'get_hr_curve',
      title: 'Heart Rate Curve',
      description: `Fetches HR curves showing maximum sustained heart rate at various durations for a given date range.

<use-cases>
- Analyzing maximum heart rate capabilities across different durations.
- Tracking HR improvements or changes over time at various effort durations.
- Comparing current HR curve to previous periods to assess cardiovascular fitness changes.
- Understanding heart rate response patterns across different intensity levels.
- Filtering by sport to analyze sport-specific heart rate characteristics.
</use-cases>

<instructions>
- This tool returns data for the following durations: 5s, 30s, 1min, 5min, 20min, 60min, 2hr. If you need data for a different set of durations, use the optional durations input.
- Optional: Use compare_to_oldest and compare_to_newest if you need to compare changes to a previous period
</instructions>

<notes>
- All date parameters accept ISO format (YYYY-MM-DD) or natural language ("90 days ago", "last month", etc.)
</notes>`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "30 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport (omit for all sports)'),
        durations: z.array(z.number()).optional().describe('Custom durations in seconds (e.g., [5, 60, 300, 1200])'),
        compare_to_oldest: z.string().optional().describe('Comparison period start date (e.g., "2024-01-01", "90 days ago")'),
        compare_to_newest: z.string().optional().describe('Comparison period end date'),
      },
      outputSchema: schemas.hrCurveOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string; sport?: 'cycling' | 'running' | 'swimming'; durations?: number[]; compare_to_oldest?: string; compare_to_newest?: string }) =>
        this.historicalTools.getHRCurve(args),
    });
  }
}
