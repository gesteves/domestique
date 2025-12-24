import type {
  RecoveryData,
  StrainData,
  StrainActivity,
  WhoopConfig,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import {
  getWhoopAccessToken,
  getWhoopRefreshToken,
  storeWhoopTokens,
} from '../utils/redis.js';

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Error thrown when Whoop API calls fail in a potentially recoverable way.
 * The message is designed to be helpful to LLMs that may retry the operation.
 */
export class WhoopApiError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'WhoopApiError';
  }
}

/**
 * Check if a UTC timestamp falls within a local date range given the timezone.
 */
function isTimestampInLocalDateRange(
  utcTimestamp: string,
  startDate: string,
  endDate: string,
  timezone: string
): boolean {
  // Format the UTC timestamp as a local date in the given timezone
  const date = new Date(utcTimestamp);
  const localDateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format

  return localDateStr >= startDate && localDateStr <= endDate;
}

interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: string;
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

interface WhoopSleep {
  id: number;
  cycle_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
}

interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end?: string;
  timezone_offset: string;
  score_state: string;
  score: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string; // Use this instead of sport_id (deprecated after 09/01/2025)
  score_state: string;
  score: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations?: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

// Whoop sport_name to normalized activity type mapping
const WHOOP_SPORT_NAME_MAP: Record<string, string> = {
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  'functional fitness': 'Functional Fitness',
  hiit: 'HIIT',
  skiing: 'Skiing',
  rowing: 'Rowing',
  'weightlifting': 'Strength',
  'strength trainer': 'Strength',
};

export class WhoopClient {
  private config: WhoopConfig;
  private accessToken: string;
  private tokenExpiresAt: number = 0;
  private refreshToken: string;
  private timezoneGetter: (() => Promise<string>) | null = null;

  constructor(config: WhoopConfig) {
    this.config = config;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  /**
   * Set a function that returns the user's timezone.
   * Used to filter results to match local date ranges.
   */
  setTimezoneGetter(getter: () => Promise<string>): void {
    this.timezoneGetter = getter;
  }

  /**
   * Get the user's timezone, defaulting to UTC if not configured.
   */
  private async getTimezone(): Promise<string> {
    if (this.timezoneGetter) {
      return this.timezoneGetter();
    }
    return 'UTC';
  }

  /**
   * Mask a token for logging (show first 4 and last 4 characters)
   */
  private maskToken(token: string): string {
    if (token.length <= 12) return '***';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Tries Redis cache first, then falls back to refresh.
   * Includes retry logic for transient failures.
   */
  private async ensureValidToken(): Promise<void> {
    // First, try to get a cached access token from Redis
    const cachedToken = await getWhoopAccessToken();
    if (cachedToken) {
      console.log('[Whoop] Using cached access token from Redis');
      this.accessToken = cachedToken.token;
      this.tokenExpiresAt = cachedToken.expiresAt;
      return;
    }

    // Check if current in-memory token is still valid
    if (Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      console.log('[Whoop] Using valid in-memory access token');
      return;
    }

    // Try to get refresh token from Redis, fall back to config
    const storedRefreshToken = await getWhoopRefreshToken();
    const refreshToken = storedRefreshToken ?? this.refreshToken;
    const tokenSource = storedRefreshToken ? 'Redis' : 'config';
    console.log(`[Whoop] Starting token refresh using ${tokenSource} refresh token: ${this.maskToken(refreshToken)}`);

    // Refresh the token with retry logic
    let lastError: Error | null = null;
    let attemptsMade = 0;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      attemptsMade = attempt;
      try {
        console.log(`[Whoop] Token refresh attempt ${attempt}/${MAX_RETRY_ATTEMPTS}`);
        const response = await fetch(WHOOP_AUTH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          console.log(`[Whoop] Token refresh successful on attempt ${attempt}, new refresh token: ${this.maskToken(data.refresh_token)}, expires in ${data.expires_in}s`);

          this.accessToken = data.access_token;
          this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
          this.refreshToken = data.refresh_token;

          // Store tokens in Redis for future use
          await storeWhoopTokens({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt,
          });
          return;
        }

        // Log the error response
        const responseText = await response.text();
        console.error(`[Whoop] Token refresh failed with ${response.status} ${response.statusText}: ${responseText}`);

        // Determine if this is a retryable error (5xx server errors)
        const isServerError = response.status >= 500 && response.status < 600;
        lastError = new Error(
          `Whoop token refresh failed: ${response.status} ${response.statusText}`
        );

        // For 400 errors, check if another request already refreshed the token
        if (response.status === 400) {
          console.log('[Whoop] Got 400 error, checking if another request already refreshed the token...');
          const freshToken = await getWhoopAccessToken();
          if (freshToken) {
            console.log('[Whoop] Found fresh access token in Redis (likely refreshed by concurrent request), using it');
            this.accessToken = freshToken.token;
            this.tokenExpiresAt = freshToken.expiresAt;
            return;
          }
          console.log('[Whoop] No fresh token found in Redis, refresh token may be invalid');
        }

        if (isServerError && attempt < MAX_RETRY_ATTEMPTS) {
          // Exponential backoff: 1s, 2s, 4s...
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Whoop] Server error, retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        // Non-retryable error (4xx) or exhausted retries
        break;
      } catch (error) {
        // Network errors are retryable
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Whoop] Network error on attempt ${attempt}: ${lastError.message}`);
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Whoop] Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }
        break;
      }
    }

    // All retries exhausted - throw a helpful error
    throw new WhoopApiError(
      `Whoop API is temporarily unavailable. The token refresh failed after ${attemptsMade} attempt(s). ` +
        `This is typically a transient issue with the Whoop API. Please try this request again in a few moments. ` +
        `Original error: ${lastError?.message ?? 'Unknown error'}`,
      true
    );
  }

  private async fetch<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    await this.ensureValidToken();

    const url = new URL(`${WHOOP_API_BASE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Whoop API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get recovery data for a date range.
   * Follows cycle → sleep → recovery relationship.
   * Filters results to match the user's local timezone.
   */
  async getRecoveries(startDate: string, endDate: string): Promise<RecoveryData[]> {
    const timezone = await this.getTimezone();

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    // Fetch all three data sources
    const [cycles, sleeps, recoveries] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopSleep[] }>('/activity/sleep', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopRecovery[] }>('/recovery', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
    ]);

    // Build lookup maps
    // Sleep by cycle_id (non-nap, scored)
    const sleepByCycleId = new Map<number, WhoopSleep>();
    for (const sleep of sleeps.records) {
      if (!sleep.nap && sleep.score_state === 'SCORED') {
        sleepByCycleId.set(sleep.cycle_id, sleep);
      }
    }

    // Recovery by sleep_id (scored)
    const recoveryBySleepId = new Map<number, WhoopRecovery>();
    for (const recovery of recoveries.records) {
      if (recovery.score_state === 'SCORED') {
        recoveryBySleepId.set(recovery.sleep_id, recovery);
      }
    }

    // Follow the correct chain: cycle → sleep → recovery
    const results: RecoveryData[] = [];
    for (const cycle of cycles.records) {
      if (cycle.score_state !== 'SCORED') continue;

      const sleep = sleepByCycleId.get(cycle.id);
      if (!sleep) continue;

      const recovery = recoveryBySleepId.get(sleep.id);
      if (!recovery) continue;

      const normalized = this.normalizeRecovery(recovery, sleep);
      // Filter by local date in user's timezone
      if (isTimestampInLocalDateRange(recovery.created_at, startDate, endDate, timezone)) {
        results.push(normalized);
      }
    }

    return results;
  }

  /**
   * Add days to a date string
   */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Subtract days from a date string
   */
  private subtractDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get today's recovery by finding the most recent scored cycle.
   * This follows Whoop's physiological day model rather than calendar dates.
   */
  async getTodayRecovery(): Promise<RecoveryData | null> {
    // Get recent data (last few days to ensure we catch the current cycle)
    const [cycles, sleeps, recoveries] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle'),
      this.fetch<{ records: WhoopSleep[] }>('/activity/sleep'),
      this.fetch<{ records: WhoopRecovery[] }>('/recovery'),
    ]);

    // Find the most recent scored cycle
    const scoredCycle = cycles.records.find((c) => c.score_state === 'SCORED');
    if (!scoredCycle) return null;

    // Find the sleep for this cycle (non-nap, scored)
    const sleep = sleeps.records.find(
      (s) =>
        s.cycle_id === scoredCycle.id &&
        s.score_state === 'SCORED' &&
        !s.nap
    );
    if (!sleep) return null;

    // Find the recovery for this sleep (scored)
    const recovery = recoveries.records.find(
      (r) => r.sleep_id === sleep.id && r.score_state === 'SCORED'
    );
    if (!recovery) return null;

    return this.normalizeRecovery(recovery, sleep);
  }

  /**
   * Get today's strain by finding the current in-progress cycle.
   * The current cycle is identified by having no 'end' field.
   */
  async getTodayStrain(): Promise<StrainData | null> {
    const timezone = await this.getTimezone();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

    // Get recent data without date parameters to get current cycle
    const [cycles, workouts] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle'),
      this.fetch<{ records: WhoopWorkout[] }>('/activity/workout'),
    ]);

    // Find the current cycle (no end date means in progress)
    const currentCycle = cycles.records.find((c) => !c.end);
    if (!currentCycle) return null;

    // Current cycle may not be scored yet (PENDING_SCORE)
    if (currentCycle.score_state !== 'SCORED') return null;

    // Find workouts that started after this cycle began
    const cycleWorkouts = workouts.records.filter((w) => {
      return new Date(w.start) >= new Date(currentCycle.start);
    });

    // Current cycle = today's date
    return this.normalizeStrain(currentCycle, cycleWorkouts, todayStr);
  }

  /**
   * Get strain/cycle data for a date range.
   * Filters results to match the user's local timezone.
   *
   * A cycle's date is determined by its END time (when you went to sleep),
   * not its start time. For the current in-progress cycle (no end), we use today's date.
   */
  async getStrainData(startDate: string, endDate: string): Promise<StrainData[]> {
    const timezone = await this.getTimezone();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    const [cycles, workouts] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
    ]);

    // Determine each cycle's date based on END time (or today if in-progress)
    const cyclesWithDates = cycles.records.map((cycle) => {
      const cycleDate = !cycle.end
        ? todayStr
        : new Date(cycle.end).toLocaleDateString('en-CA', { timeZone: timezone });
      return { cycle, cycleDate };
    });

    // Group workouts by the cycle they belong to (started after cycle start, before cycle end)
    const getWorkoutsForCycle = (cycle: WhoopCycle): WhoopWorkout[] => {
      const cycleStart = new Date(cycle.start);
      const cycleEnd = cycle.end ? new Date(cycle.end) : new Date();
      return workouts.records.filter((w) => {
        const workoutStart = new Date(w.start);
        return workoutStart >= cycleStart && workoutStart <= cycleEnd;
      });
    };

    return cyclesWithDates
      .filter(({ cycle }) => cycle.score_state === 'SCORED')
      .map(({ cycle, cycleDate }) => {
        const cycleWorkouts = getWorkoutsForCycle(cycle);
        return this.normalizeStrain(cycle, cycleWorkouts, cycleDate);
      })
      .filter((s) => s.date >= startDate && s.date <= endDate);
  }

  /**
   * Get workouts/activities for a date range.
   * Filters results to match the user's local timezone.
   */
  async getWorkouts(startDate: string, endDate: string): Promise<StrainActivity[]> {
    const timezone = await this.getTimezone();

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    const workouts = await this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
      start: `${startBuffer}T00:00:00.000Z`,
      end: `${endBuffer}T23:59:59.999Z`,
    });

    return workouts.records
      .map((w) => this.normalizeWorkout(w))
      .filter((w) => isTimestampInLocalDateRange(w.start_time, startDate, endDate, timezone));
  }

  private normalizeRecovery(
    recovery: WhoopRecovery,
    sleep?: WhoopSleep
  ): RecoveryData {
    const sleepScore = sleep?.score;
    const stageSummary = sleepScore?.stage_summary;
    const sleepNeeded = sleepScore?.sleep_needed;

    const milliToHours = (milli: number) => milli / (1000 * 60 * 60);

    const totalSleepMilli = stageSummary
      ? stageSummary.total_light_sleep_time_milli +
        stageSummary.total_slow_wave_sleep_time_milli +
        stageSummary.total_rem_sleep_time_milli
      : 0;

    return {
      date: recovery.created_at.split('T')[0],
      // Recovery metrics
      recovery_score: recovery.score.recovery_score,
      hrv_rmssd: recovery.score.hrv_rmssd_milli,
      resting_heart_rate: recovery.score.resting_heart_rate,
      spo2_percentage: recovery.score.spo2_percentage,
      skin_temp_celsius: recovery.score.skin_temp_celsius,
      // Sleep performance metrics
      sleep_performance_percentage: sleepScore?.sleep_performance_percentage ?? 0,
      sleep_consistency_percentage: sleepScore?.sleep_consistency_percentage,
      sleep_efficiency_percentage: sleepScore?.sleep_efficiency_percentage,
      // Sleep duration metrics
      sleep_duration_hours: milliToHours(totalSleepMilli),
      sleep_quality_duration_hours: stageSummary
        ? milliToHours(
            stageSummary.total_slow_wave_sleep_time_milli +
              stageSummary.total_rem_sleep_time_milli
          )
        : undefined,
      sleep_needed_hours: sleepNeeded
        ? milliToHours(
            sleepNeeded.baseline_milli +
              sleepNeeded.need_from_sleep_debt_milli +
              sleepNeeded.need_from_recent_strain_milli -
              sleepNeeded.need_from_recent_nap_milli
          )
        : undefined,
      // Sleep stage breakdown
      light_sleep_hours: stageSummary
        ? milliToHours(stageSummary.total_light_sleep_time_milli)
        : undefined,
      slow_wave_sleep_hours: stageSummary
        ? milliToHours(stageSummary.total_slow_wave_sleep_time_milli)
        : undefined,
      rem_sleep_hours: stageSummary
        ? milliToHours(stageSummary.total_rem_sleep_time_milli)
        : undefined,
      awake_hours: stageSummary
        ? milliToHours(stageSummary.total_awake_time_milli)
        : undefined,
      in_bed_hours: stageSummary
        ? milliToHours(stageSummary.total_in_bed_time_milli)
        : undefined,
      // Sleep details
      sleep_cycle_count: stageSummary?.sleep_cycle_count,
      disturbance_count: stageSummary?.disturbance_count,
      respiratory_rate: sleepScore?.respiratory_rate,
    };
  }

  private normalizeStrain(cycle: WhoopCycle, workouts: WhoopWorkout[], localDate: string): StrainData {
    return {
      date: localDate,
      strain_score: cycle.score.strain,
      average_heart_rate: cycle.score.average_heart_rate,
      max_heart_rate: cycle.score.max_heart_rate,
      calories: Math.round(cycle.score.kilojoule / 4.184),
      activities: workouts.map((w) => this.normalizeWorkout(w)),
    };
  }

  private normalizeWorkout(workout: WhoopWorkout): StrainActivity {
    // Use sport_name (sport_id is deprecated after 09/01/2025)
    const sportName =
      WHOOP_SPORT_NAME_MAP[workout.sport_name.toLowerCase()] ??
      workout.sport_name;

    const zoneDurations = workout.score.zone_durations
      ? {
          zone_0_minutes: workout.score.zone_durations.zone_zero_milli / 60000,
          zone_1_minutes: workout.score.zone_durations.zone_one_milli / 60000,
          zone_2_minutes: workout.score.zone_durations.zone_two_milli / 60000,
          zone_3_minutes: workout.score.zone_durations.zone_three_milli / 60000,
          zone_4_minutes: workout.score.zone_durations.zone_four_milli / 60000,
          zone_5_minutes: workout.score.zone_durations.zone_five_milli / 60000,
        }
      : undefined;

    return {
      id: String(workout.id),
      activity_type: normalizeActivityType(sportName),
      start_time: workout.start,
      end_time: workout.end,
      strain_score: workout.score.strain,
      average_heart_rate: workout.score.average_heart_rate,
      max_heart_rate: workout.score.max_heart_rate,
      calories: Math.round(workout.score.kilojoule / 4.184),
      distance_meters: workout.score.distance_meter,
      altitude_gain_meters: workout.score.altitude_gain_meter,
      zone_durations: zoneDurations,
    };
  }
}
