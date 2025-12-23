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

  constructor(config: WhoopConfig) {
    this.config = config;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Tries Redis cache first, then falls back to refresh.
   */
  private async ensureValidToken(): Promise<void> {
    // First, try to get a cached access token from Redis
    const cachedToken = await getWhoopAccessToken();
    if (cachedToken) {
      this.accessToken = cachedToken.token;
      this.tokenExpiresAt = cachedToken.expiresAt;
      return;
    }

    // Check if current in-memory token is still valid
    if (Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return;
    }

    // Try to get refresh token from Redis, fall back to config
    const storedRefreshToken = await getWhoopRefreshToken();
    const refreshToken = storedRefreshToken ?? this.refreshToken;

    // Refresh the token
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

    if (!response.ok) {
      throw new Error(
        `Whoop token refresh failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    this.refreshToken = data.refresh_token;

    // Store tokens in Redis for future use
    await storeWhoopTokens({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.tokenExpiresAt,
    });
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
   */
  async getRecoveries(startDate: string, endDate: string): Promise<RecoveryData[]> {
    // Fetch all three data sources
    const [cycles, sleeps, recoveries] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle', {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopSleep[] }>('/activity/sleep', {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopRecovery[] }>('/recovery', {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
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

      results.push(this.normalizeRecovery(recovery, sleep));
    }

    return results;
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
   * Get strain/cycle data for a date range
   */
  async getStrainData(startDate: string, endDate: string): Promise<StrainData[]> {
    const cycles = await this.fetch<{ records: WhoopCycle[] }>('/cycle', {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    });

    const workouts = await this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    });

    const workoutsByDate = new Map<string, WhoopWorkout[]>();
    for (const workout of workouts.records) {
      const date = workout.start.split('T')[0];
      if (!workoutsByDate.has(date)) {
        workoutsByDate.set(date, []);
      }
      workoutsByDate.get(date)!.push(workout);
    }

    return cycles.records
      .filter((c) => c.score_state === 'SCORED')
      .map((c) => {
        const date = c.start.split('T')[0];
        const dayWorkouts = workoutsByDate.get(date) ?? [];
        return this.normalizeStrain(c, dayWorkouts);
      });
  }

  /**
   * Get workouts/activities for a date range
   */
  async getWorkouts(startDate: string, endDate: string): Promise<StrainActivity[]> {
    const workouts = await this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    });

    return workouts.records.map((w) => this.normalizeWorkout(w));
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

  private normalizeStrain(cycle: WhoopCycle, workouts: WhoopWorkout[]): StrainData {
    return {
      date: cycle.start.split('T')[0],
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
