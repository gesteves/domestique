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
  sport_id: number;
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
    zone_duration?: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

// Whoop sport ID to activity type mapping
const WHOOP_SPORT_MAP: Record<number, string> = {
  0: 'Running',
  1: 'Cycling',
  33: 'Swimming',
  44: 'Functional Fitness',
  52: 'HIIT',
  63: 'Skiing',
  71: 'Rowing',
  82: 'Strength',
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
   * Get recovery data for a date range
   */
  async getRecoveries(startDate: string, endDate: string): Promise<RecoveryData[]> {
    const recoveries = await this.fetch<{ records: WhoopRecovery[] }>('/recovery', {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    });

    const sleeps = await this.fetch<{ records: WhoopSleep[] }>('/activity/sleep', {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    });

    const sleepMap = new Map<number, WhoopSleep>();
    for (const sleep of sleeps.records) {
      if (!sleep.nap) {
        sleepMap.set(sleep.id, sleep);
      }
    }

    return recoveries.records
      .filter((r) => r.score_state === 'SCORED')
      .map((r) => {
        const sleep = sleepMap.get(r.sleep_id);
        return this.normalizeRecovery(r, sleep);
      });
  }

  /**
   * Get today's recovery
   */
  async getTodayRecovery(): Promise<RecoveryData | null> {
    const today = new Date().toISOString().split('T')[0];
    const recoveries = await this.getRecoveries(today, today);
    return recoveries.length > 0 ? recoveries[0] : null;
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

    const totalSleepMilli = stageSummary
      ? stageSummary.total_light_sleep_time_milli +
        stageSummary.total_slow_wave_sleep_time_milli +
        stageSummary.total_rem_sleep_time_milli
      : 0;

    return {
      date: recovery.created_at.split('T')[0],
      recovery_score: recovery.score.recovery_score,
      hrv_rmssd: recovery.score.hrv_rmssd_milli,
      resting_heart_rate: recovery.score.resting_heart_rate,
      sleep_performance_percentage: sleepScore?.sleep_performance_percentage ?? 0,
      sleep_duration_hours: totalSleepMilli / (1000 * 60 * 60),
      sleep_quality_duration_hours: stageSummary
        ? (stageSummary.total_slow_wave_sleep_time_milli +
            stageSummary.total_rem_sleep_time_milli) /
          (1000 * 60 * 60)
        : undefined,
      sleep_needed_hours: sleepNeeded
        ? (sleepNeeded.baseline_milli +
            sleepNeeded.need_from_sleep_debt_milli +
            sleepNeeded.need_from_recent_strain_milli -
            sleepNeeded.need_from_recent_nap_milli) /
          (1000 * 60 * 60)
        : undefined,
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
    const sportName = WHOOP_SPORT_MAP[workout.sport_id] ?? 'Other';

    return {
      id: String(workout.id),
      activity_type: normalizeActivityType(sportName),
      start_time: workout.start,
      end_time: workout.end,
      strain_score: workout.score.strain,
      average_heart_rate: workout.score.average_heart_rate,
      max_heart_rate: workout.score.max_heart_rate,
      calories: Math.round(workout.score.kilojoule / 4.184),
    };
  }
}
