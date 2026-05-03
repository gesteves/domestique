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

// Boilerplate inlined into tool descriptions. Centralized so wording stays
// consistent across the four tools that surface this caveat.
const STRAVA_LIMITATION_NOTE =
  'Workouts imported from Strava are unavailable due to Strava API Agreement restrictions, and **CANNOT** be analyzed for full per-workout detail (intervals, notes, weather, etc.).';
const SCHEDULED_ORDERING_NOTE =
  'Scheduled workouts may not necessarily be in the order the user intends to do them; ask them for clarification if necessary.';
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';
import * as schemas from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from '../utils/response-builder.js';
import { formatResponseDates } from '../utils/date-formatting.js';
import { type HintGenerator, generateHints } from '../utils/hints.js';
import { runWithUnitPreferences, METRIC_DEFAULTS } from '../utils/unit-context.js';
import type { UnitPreferences, UpdateActivityInput } from '../types/index.js';
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
      description: `One-shot snapshot of the user's status today: Whoop recovery / sleep / strain, Intervals.icu fitness metrics (CTL, ATL, TSB) and wellness, completed and planned workouts (with matched Whoop strain), today's scheduled race, and the weather forecast for the user's configured locations. Always prefer this for any "today's" data question — recovery, sleep, strain, workouts, or readiness — over assembling the same picture from individual tools. State changes throughout the day, so re-call rather than relying on a previous response. ${SCHEDULED_ORDERING_NOTE} ${STRAVA_LIMITATION_NOTE}`,
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
        description: `Weather forecast for a single date (today through 10 days out) at one or more locations. Returns a daily summary, hourly forecast, sun/moon events, and (where available) pollen and air quality; when the date is today, also includes current conditions and active alerts. Pass no arguments for today at the user's configured weather locations; pass \`date\` and/or \`location\` for race-week or destination planning. The today's-snapshot tool already embeds today's forecast for configured locations — only call this directly when the user asks specifically about weather, a future date, or a custom location.`,
        inputSchema: schemas.forecastInputSchema,
        outputSchema: schemas.forecastOutputSchema,
        annotations: READ_ONLY,
        handler: async (args: { date?: string; location?: string }) => this.currentTools.getWeatherForecast(args),
      });
    }

    register({
      name: 'get_todays_workouts',
      title: "Today's Workouts",
      description: `Today's completed and planned workouts only, with completed workouts in full detail (intervals, notes, weather, zones, heat zones, music) and matched Whoop strain. Use this when the user asks specifically about today's training and you don't need recovery, sleep, wellness, or fitness metrics — the broader today's-snapshot tool returns workout summaries only, so call this when full per-activity detail for today is required. Re-call as the day progresses; cached results go stale. ${SCHEDULED_ORDERING_NOTE} ${STRAVA_LIMITATION_NOTE}`,
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
      description: `Returns the athlete's static profile from Intervals.icu — name, location, timezone, gender, date of birth, age, and unit preferences. Useful for personalizing references to the user (e.g., distinguishing their workout notes from a coach's), framing age-relative fitness or HR zones, and confirming the unit system in use. Domestique already formats every unit-bearing field server-side per the athlete's preferences, so do not re-convert returned values unless asked.`,
      inputSchema: {},
      outputSchema: schemas.athleteProfileOutputSchema,
      annotations: READ_ONLY,
      handler: async () => this.currentTools.getAthleteProfile(),
    });

    register({
      name: 'get_sports_settings',
      title: 'Sport Settings',
      description: `Sport-specific configuration from Intervals.icu — FTP, threshold pace, max/threshold HR, and the corresponding HR/power/pace zones — for cycling, running, and/or swimming. Use this to interpret workout intensity, compare effort to current capability, or recommend zone-based targets. Pass a \`sports\` array to fetch a subset; omit it to fetch all three in one call. These are the athlete's **current** zones; workouts from the past may have used different zones, which appear inline on those workouts.`,
      inputSchema: {
        sports: z
          .array(z.enum(['cycling', 'running', 'swimming']))
          .optional()
          .describe('Sports to fetch settings for. Omit to fetch all three.'),
      },
      outputSchema: schemas.sportSettingsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { sports?: ('cycling' | 'running' | 'swimming')[] }) =>
        this.currentTools.getSportSettings(args.sports),
    });

    // Historical/Trends Tools
    if (this.hasWhoop) {
      register({
        name: 'get_strain_history',
        title: 'Strain History',
        description: `Daily Whoop strain (0-21, logarithmic) over a date range, plus the per-day list of activities the user logged in the Whoop app. Use this to spot strain trends, correlate strain against recovery trends, or identify high- or low-load periods. Date parameters accept ISO YYYY-MM-DD or natural language ("yesterday", "7 days ago", "last week").`,
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
      description: `Completed workouts and fitness activities in a past date range, with comprehensive summary metrics and matched Whoop strain. Use for training-pattern analysis, volume/intensity review, or to find activity IDs to drive deeper per-workout inspection (intervals, notes, weather, music are fetched separately). Date parameters accept ISO YYYY-MM-DD or natural language ("30 days ago", "last Monday", "December 1"); optional \`sport\` filters by discipline. **Never** pass today's date — past dates only. ${STRAVA_LIMITATION_NOTE}`,
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
      description: `Full per-workout drill-down for a single activity by ID — interval-by-interval power/HR/cadence, interval groups, athlete and coach notes, weather, power/pace/HR/heat zones, scrobbled music (when Last.fm is configured), and matched Whoop strain — all in one call. Activity IDs are surfaced anywhere completed workouts are listed (past-range history queries, today's-snapshot tools, etc.). Returns substantially more data than a history list entry, so call only when the user wants depth on a specific workout. ${STRAVA_LIMITATION_NOTE}`,
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
        description: `Daily Whoop recovery, sleep, and HRV over a date range, plus per-period summary statistics. Use to spot recovery trends, correlate recovery against training load or completed workouts, or flag periods of poor recovery that suggest overtraining. Date parameters accept ISO YYYY-MM-DD or natural language ("yesterday", "7 days ago", "last week").`,
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
      description: `Daily Intervals.icu wellness over a date range: HRV, resting HR, sleep (duration / score / quality), SpO2, blood pressure, body composition, subjective scores (mood, fatigue, soreness, stress), nutrition, steps, and any other metric the athlete has recorded. Each day carries a \`sources\` map naming the provider feeding each present field (typically garmin / oura / whoop), so when Whoop is also connected you can reconcile the same metric across platforms against the parallel \`whoop.*\` data exposed by Whoop-backed tools. Date parameters accept ISO YYYY-MM-DD or natural language; only days with recorded data are returned.`,
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
      description: `Aggregate training totals over a date range — duration, distance, climbing, training load, calories — broken down per sport, with HR/power/pace zone distributions for each. Use for volume summaries (last 90 days, last year), polarized-vs-threshold balance checks, or cross-sport comparisons. Optional \`sports\` array filters which disciplines are included. Zone names reflect the athlete's current sport settings (e.g., "Endurance", "Sweet Spot"); date parameters accept ISO YYYY-MM-DD or natural language.`,
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
      description: `Planned workouts in a future date range, merged from TrainerRoad and Intervals.icu calendars (TrainerRoad wins on duplicates because it carries more detail). Use for weekly/monthly schedule views, expected-load summaries, or to surface untriaged TrainerRoad runs that should sync to Intervals.icu. Defaults to today through 7 days out; \`oldest\` and \`newest\` accept ISO YYYY-MM-DD or natural language; optional \`sport\` filter narrows by discipline. ${SCHEDULED_ORDERING_NOTE}`,
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
        description: `Upcoming races detected on the TrainerRoad calendar (an all-day event paired with workout legs of the same name). Use this for race-schedule context, periodization decisions, and taper conversations. Race \`description\` often carries the race priority (A/B/C) and course notes — read it before recommending training adjustments.`,
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
      description: `Creates a structured workout on the user's Intervals.icu calendar; cycling and running workouts then sync to Zwift and Garmin. The caller is responsible for generating valid Intervals.icu workout-doc syntax — there is no schema validation, so a malformed doc will create a broken workout. When mirroring a TrainerRoad run, set \`sport\` to "running" and pass the TR workout UID as \`trainerroad_uid\` so orphan tracking can detect later changes; the field is ignored for other sports. Created workouts are tagged \`domestique\`, which is the gating condition for the matching update / delete tools — fix mistakes by deleting and recreating.`,
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
      description: `Permanently removes a Domestique-created planned workout from the user's Intervals.icu calendar. Only works on events tagged \`domestique\` (i.e., events Domestique itself created — directly or via the TrainerRoad sync flow); attempts to delete other events fail. Event IDs are surfaced anywhere planned workouts are listed (today's snapshot, upcoming-workouts queries). Use to fix incorrect workouts (delete then recreate) or to clear orphans when a TrainerRoad plan changes.`,
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
      description: `Updates a Domestique-created planned workout (name, description, scheduled date, sport \`type\`, or structured \`workout_doc\`). Only works on events tagged \`domestique\`; the tag is preserved on update. Pass only the fields you want to change — omitted fields are left intact. Changing \`type\` (e.g., Run to Ride) without also updating \`workout_doc\` can leave the doc in a syntax invalid for the new sport. Event IDs are surfaced anywhere planned workouts are listed (today's snapshot, upcoming-workouts queries).`,
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
        description: `Reconciles TrainerRoad running workouts against the Intervals.icu calendar over a date range (defaults today through 30 days out). Runs only — TrainerRoad cycling and swimming are not synced. The response splits into \`runs_to_sync\` (new TR runs not yet on Intervals.icu — caller is expected to follow up by creating each as a structured running workout), \`runs_to_update\` (TR runs whose source has changed), and \`deleted\` (orphans whose TR source was removed, cleaned up automatically). Call this when the user asks to sync TrainerRoad, before showing this week's plan, or when adjusting after a TR plan change.`,
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
      description: `Stamps interval boundaries onto a completed activity so Intervals.icu can recompute per-interval power, HR, cadence, TSS, etc. Each interval needs \`start_time\` and \`end_time\` in seconds from activity start (convert HH:MM:SS first — e.g., "0:05:00" → 300) and a \`type\` of WORK or RECOVERY. Infer type from the workout's own embedded \`power_zones\` (not current athlete sport settings, since FTP may have shifted): Zone 1 is typically RECOVERY, higher zones WORK, but use judgement (e.g., a Zone 2 effort right after a Zone 5 surge can read as recovery). \`replace_existing_intervals\` defaults to true (wipe and replace); pass false to merge with existing intervals.`,
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
      description: `Updates a completed activity in Intervals.icu — fix auto-generated names, capture post-workout notes, or write FORM Goggles efficiency scores back to swim activities (e.g. transcribed from a screenshot of the FORM app). At least one field must be provided; omitted fields are left intact. Affects completed/recorded activities only — planned (future) workouts have a separate edit path. Activity IDs are surfaced anywhere completed workouts are listed. The FORM scores are unitless 0-100 values (higher is better); they're stored as custom fields on Intervals.icu and surface back through \`get_workout_details\` for swims.`,
      inputSchema: {
        activity_id: z.string().describe('Intervals.icu activity ID'),
        name: z.string().optional().describe('New name for the activity'),
        description: z.string().optional().describe('New description/notes for the activity'),
        form_score: z.number().int().min(0).max(100).optional().describe('FORM Goggles overall efficiency score (0-100, higher is better)'),
        form_head_pitch: z.number().int().min(0).max(100).optional().describe('FORM Goggles head pitch score (0-100, higher is better)'),
        form_peak_head_roll: z.number().int().min(0).max(100).optional().describe('FORM Goggles peak head roll score (0-100, higher is better)'),
        form_time_to_neutral: z.number().int().min(0).max(100).optional().describe('FORM Goggles time-to-neutral score (0-100, higher is better)'),
        form_set_pacing: z.number().int().min(0).max(100).optional().describe('FORM Goggles set pacing score (0-100, higher is better)'),
        form_interval_pacing: z.number().int().min(0).max(100).optional().describe('FORM Goggles interval pacing score (0-100, higher is better)'),
      },
      outputSchema: schemas.updateActivityOutputSchema,
      annotations: MODIFIES_EXTERNAL,
      handler: async (args: UpdateActivityInput) => this.planningTools.updateActivity(args),
    });

    // ============================================
    // Analysis Tools
    // ============================================

    register({
      name: 'get_training_load_trends',
      title: 'Training Load Trends',
      description: `Daily CTL (fitness), ATL (fatigue), and TSB (form) over a date range, plus ramp rate and ACWR (acute:chronic workload ratio) for injury-risk assessment. Use this to spot fitness/form/fatigue trends, gate training progression on safe ramp rates, or correlate load against recovery or completed work. Date parameters accept ISO YYYY-MM-DD or natural language ("42 days ago", "last quarter"); newest defaults to today.`,
      inputSchema: {
        oldest: z.string().describe('Start date (e.g., "2024-01-01", "42 days ago")'),
        newest: z.string().optional().describe('End date (defaults to today)'),
      },
      outputSchema: schemas.trainingLoadTrendsOutputSchema,
      annotations: READ_ONLY,
      handler: async (args: { oldest: string; newest?: string }) =>
        this.historicalTools.getTrainingLoadTrends(args),
    });

    // ============================================
    // Performance Curves
    // ============================================

    register({
      name: 'get_power_curve',
      title: 'Power Curve',
      description: `Cycling power curve over a date range — best sustained power for each canonical duration (5s, 30s, 1min, 5min, 20min, 60min, 2hr by default; pass \`durations\` in seconds to customize). Each best includes the source activity ID and date, plus W/kg and an estimated FTP from best 20-minute power. Pass \`compare_to_oldest\` and \`compare_to_newest\` to also fit a comparison curve and surface deltas per duration; the \`comparison\` field is always present, null when no comparison range was supplied. All date parameters accept ISO YYYY-MM-DD or natural language.`,
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
      description: `Pace curve for running or swimming over a date range — best time achieved at each canonical race distance, with the source activity ID and date. Defaults span 400 m through marathon for running and 100 m through Ironman swim for swimming; pass \`distances\` in meters to customize. Set \`gap: true\` for running to use gradient-adjusted pace (normalizes for hills); irrelevant for swimming. Pass \`compare_to_oldest\` and \`compare_to_newest\` to also fit a comparison curve and surface deltas; \`comparison\` is always present, null when no comparison range was supplied.`,
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
      description: `Heart rate curve over a date range — maximum sustained HR for each canonical duration (5s, 30s, 1min, 5min, 20min, 60min, 2hr by default; pass \`durations\` to customize), with the source activity ID and date. Optional \`sport\` narrows to a single discipline so HR responses can be compared against sport-specific demands. Pass \`compare_to_oldest\` and \`compare_to_newest\` to also fit a comparison curve and surface deltas; \`comparison\` is always present, null when no comparison range was supplied.`,
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
