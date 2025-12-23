import type {
  NormalizedWorkout,
  FitnessMetrics,
  PlannedWorkout,
  IntervalsConfig,
  DailyTrainingLoad,
  TrainingLoadTrends,
  TrainingLoadSummary,
  CTLTrend,
  ACWRStatus,
  AthleteProfile,
  SportSettings,
  HRZone,
  PowerZone,
  PaceZone,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

// Athlete profile from /profile endpoint
interface IntervalsAthleteProfile {
  athlete: {
    id: string;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    timezone?: string;
    sex?: string;
  };
}

// Sport settings from /sport-settings endpoint
interface IntervalsSportSettings {
  id: number;
  athlete_id: string;
  types: string[];
  ftp?: number;
  indoor_ftp?: number;
  lthr?: number;
  max_hr?: number;
  hr_zones?: number[];
  hr_zone_names?: string[];
  power_zones?: number[];
  power_zone_names?: string[];
  threshold_pace?: number;
  pace_units?: string;
  pace_zones?: number[];
  pace_zone_names?: string[];
}

// Zone time entry from Intervals.icu
interface IntervalsZoneTime {
  id: string; // e.g., "Z1", "Z2", "SS"
  secs: number;
}

interface IntervalsActivity {
  id: string;
  start_date_local: string;
  start_date: string; // UTC timestamp with Z suffix
  type: string;
  name?: string;
  description?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  icu_training_load?: number;
  icu_intensity?: number;
  weighted_avg_watts?: number;
  average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain?: number;
  calories?: number;
  pace?: number;

  // Speed metrics
  average_speed?: number; // m/s
  max_speed?: number;

  // Coasting
  coasting_time?: number; // seconds

  // Training load & feel
  rpe?: number;
  icu_rpe?: number; // Intervals.icu RPE (may differ from rpe)
  feel?: number;

  // Activity context flags
  trainer?: boolean;
  commute?: boolean;
  race?: boolean;

  // Zone thresholds used for this activity
  icu_hr_zones?: number[]; // HR zone boundaries
  icu_power_zones?: number[]; // Power zone boundaries (% of FTP)
  pace_zones?: number[]; // Pace zone boundaries

  // Time in zones
  icu_zone_times?: IntervalsZoneTime[]; // Power zone times with zone IDs
  icu_hr_zone_times?: number[]; // Seconds per HR zone
  pace_zone_times?: number[]; // Seconds per pace zone

  // Advanced power metrics
  icu_joules_above_ftp?: number;
  icu_max_wbal_depletion?: number;
  polarization_index?: number;

  // Gradient adjusted pace & stride
  gap?: number; // gradient adjusted pace (sec/m)
  average_stride?: number; // meters per stride

  // Altitude
  average_altitude?: number;
  min_altitude?: number;
  max_altitude?: number;

  // Temperature
  average_temp?: number;
  min_temp?: number;
  max_temp?: number;

  // Session metrics
  session_rpe?: number;
  strain_score?: number;

  // Device info
  device_name?: string;
  power_meter?: string;

  // Classification
  workout_doc?: {
    class?: string;
  };

  // HR metrics
  hrrc?: number;
  trimp?: number;

  // Power efficiency
  variability_index?: number;
  decoupling?: number;
  efficiency_factor?: number;

  // Fitness at activity time
  ctl?: number;
  atl?: number;

  // Cadence
  average_cadence?: number;
  max_cadence?: number;

  // Thresholds for this activity
  icu_ftp?: number;
  icu_eftp?: number;
  icu_pm_ftp?: number; // activity-derived eFTP

  // Energy
  joules?: number;
  carbs_used?: number;
  carbs_ingested?: number;

  // Intervals/laps
  icu_intervals?: unknown[];
  laps?: unknown[];
  icu_lap_count?: number;
}

interface IntervalsWellness {
  id: string; // Date in YYYY-MM-DD format (used as primary key)
  ctl: number;
  atl: number;
  rampRate?: number;
  load?: number; // daily training load
}

interface IntervalsEvent {
  id: number;
  uid?: string;
  start_date_local: string;
  name: string;
  description?: string;
  type: string;
  category?: string;
  icu_training_load?: number;
  icu_intensity?: number;
  moving_time?: number;
  duration?: number;
}

export class IntervalsClient {
  private config: IntervalsConfig;
  private authHeader: string;
  private cachedTimezone: string | null = null;

  constructor(config: IntervalsConfig) {
    this.config = config;
    // Intervals.icu uses API key as password with "API_KEY" as username
    const credentials = Buffer.from(`API_KEY:${config.apiKey}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  /**
   * Get the athlete's timezone from their profile.
   * Result is cached after first fetch.
   */
  async getAthleteTimezone(): Promise<string> {
    if (this.cachedTimezone) {
      return this.cachedTimezone;
    }

    try {
      const profile = await this.fetch<IntervalsAthleteProfile>('/profile');
      this.cachedTimezone = profile.athlete.timezone ?? 'UTC';
      return this.cachedTimezone;
    } catch (error) {
      console.error('Error fetching athlete timezone, defaulting to UTC:', error);
      return 'UTC';
    }
  }

  /**
   * Get the complete athlete profile including sport settings.
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    const [profile, sportSettings] = await Promise.all([
      this.fetch<IntervalsAthleteProfile>('/profile'),
      this.fetch<IntervalsSportSettings[]>('/sport-settings'),
    ]);

    const sports = sportSettings
      .filter((s) => !s.types.includes('Other')) // Exclude 'Other' catch-all
      .map((s) => this.normalizeSportSettings(s));

    return {
      id: profile.athlete.id,
      name: profile.athlete.name,
      city: profile.athlete.city,
      state: profile.athlete.state,
      country: profile.athlete.country,
      timezone: profile.athlete.timezone,
      sex: profile.athlete.sex,
      sports,
    };
  }

  /**
   * Normalize sport settings from Intervals.icu API format.
   */
  private normalizeSportSettings(settings: IntervalsSportSettings): SportSettings {
    const result: SportSettings = {
      types: settings.types,
    };

    // FTP
    if (settings.ftp) {
      result.ftp = settings.ftp;
      // Only include indoor_ftp if different
      if (settings.indoor_ftp && settings.indoor_ftp !== settings.ftp) {
        result.indoor_ftp = settings.indoor_ftp;
      }
    }

    // Heart rate thresholds
    if (settings.lthr) result.lthr = settings.lthr;
    if (settings.max_hr) result.max_hr = settings.max_hr;

    // HR zones
    if (settings.hr_zones && settings.hr_zone_names) {
      result.hr_zones = this.mergeHRZones(
        settings.hr_zones,
        settings.hr_zone_names,
        settings.max_hr
      );
    }

    // Threshold pace
    if (settings.threshold_pace && settings.pace_units) {
      // For SECS_100M (swimming), threshold_pace is stored as speed in m/s
      // Convert to actual pace (time per distance) for display
      const paceValue = this.convertToPaceValue(settings.threshold_pace, settings.pace_units);
      result.threshold_pace = paceValue;
      result.pace_units = settings.pace_units;
      result.threshold_pace_human = this.formatPaceValue(paceValue, settings.pace_units);
    }

    // Power zones
    if (settings.power_zones && settings.power_zone_names && settings.ftp) {
      result.power_zones = this.mergePowerZones(
        settings.power_zones,
        settings.power_zone_names,
        settings.ftp
      );
      // Indoor power zones if indoor FTP differs
      if (settings.indoor_ftp && settings.indoor_ftp !== settings.ftp) {
        result.indoor_power_zones = this.mergePowerZones(
          settings.power_zones,
          settings.power_zone_names,
          settings.indoor_ftp
        );
      }
    }

    // Pace zones
    if (settings.pace_zones && settings.pace_zone_names && settings.threshold_pace && settings.pace_units) {
      // Convert threshold to actual pace value for zone calculations
      const paceValue = this.convertToPaceValue(settings.threshold_pace, settings.pace_units);
      result.pace_zones = this.mergePaceZones(
        settings.pace_zones,
        settings.pace_zone_names,
        paceValue,
        settings.pace_units
      );
    }

    return result;
  }

  /**
   * Merge HR zone boundaries with names into structured zones.
   * HR zones array contains thresholds: [138, 154, 160, 171, 176, 181, 190]
   * Names array has one name per zone: ["Recovery", "Aerobic", ...]
   */
  private mergeHRZones(
    zones: number[],
    names: string[],
    maxHR?: number
  ): HRZone[] {
    const result: HRZone[] = [];

    for (let i = 0; i < names.length; i++) {
      const low = i === 0 ? 0 : zones[i - 1];
      const high = i < zones.length ? zones[i] : null;

      result.push({
        name: names[i],
        low_bpm: low,
        high_bpm: high,
      });
    }

    return result;
  }

  /**
   * Merge power zone percentages with names and calculate absolute values.
   * Power zones array contains % of FTP: [55, 75, 90, 105, 120, 150, 999]
   */
  private mergePowerZones(
    zones: number[],
    names: string[],
    ftp: number
  ): PowerZone[] {
    const result: PowerZone[] = [];

    for (let i = 0; i < names.length; i++) {
      const lowPercent = i === 0 ? 0 : zones[i - 1];
      const highPercent = zones[i] >= 999 ? null : zones[i];

      result.push({
        name: names[i],
        low_percent: lowPercent,
        high_percent: highPercent,
        low_watts: Math.round((lowPercent / 100) * ftp),
        high_watts: highPercent ? Math.round((highPercent / 100) * ftp) : null,
      });
    }

    return result;
  }

  /**
   * Merge pace zone percentages with names and format human-readable paces.
   * Pace zones array contains % of threshold pace: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999]
   *
   * Important: Higher percentage = FASTER pace (less time per km)
   * So pace = threshold_pace / (percentage / 100)
   *
   * Example with 4:00/km threshold:
   * - 77.5% → 4.0 / 0.775 = 5.16 min/km (slower)
   * - 100%  → 4.0 / 1.0   = 4.00 min/km (threshold)
   * - 112%  → 4.0 / 1.12  = 3.57 min/km (faster)
   */
  private mergePaceZones(
    zones: number[],
    names: string[],
    thresholdPace: number,
    paceUnits: string
  ): PaceZone[] {
    const result: PaceZone[] = [];

    for (let i = 0; i < names.length; i++) {
      const lowPercent = i === 0 ? 0 : zones[i - 1];
      const highPercent = zones[i] >= 999 ? null : zones[i];

      // Calculate actual pace values
      // pace = threshold / (percentage / 100)
      // low_percent (lower %) = slower pace (more time per km)
      // high_percent (higher %) = faster pace (less time per km)
      const slowPace = lowPercent > 0 ? thresholdPace / (lowPercent / 100) : null;
      const fastPace = highPercent ? thresholdPace / (highPercent / 100) : null;

      result.push({
        name: names[i],
        low_percent: lowPercent,
        high_percent: highPercent,
        slow_pace: slowPace,
        fast_pace: fastPace,
        slow_pace_human: slowPace ? this.formatPaceValue(slowPace, paceUnits) : null,
        fast_pace_human: fastPace ? this.formatPaceValue(fastPace, paceUnits) : null,
      });
    }

    return result;
  }

  /**
   * Convert raw threshold_pace from API to actual pace value.
   * Intervals.icu stores threshold_pace as SPEED in m/s for all sports.
   * The pace_units field indicates how to DISPLAY it.
   *
   * - MINS_KM: convert m/s to minutes per km
   * - SECS_100M: convert m/s to seconds per 100m
   */
  private convertToPaceValue(rawValue: number, units: string): number {
    if (units === 'MINS_KM') {
      // rawValue is speed in m/s, convert to minutes per km
      // pace (min/km) = (1000m / speed) / 60
      return (1000 / rawValue) / 60;
    } else if (units === 'SECS_100M') {
      // rawValue is speed in m/s, convert to seconds per 100m
      // pace (sec/100m) = 100m / speed (m/s)
      return 100 / rawValue;
    }
    // Default: assume it's already the pace value
    return rawValue;
  }

  /**
   * Format a pace value (already converted) into human-readable string.
   * @param pace - Pace value (min/km for MINS_KM, sec/100m for SECS_100M)
   * @param units - "MINS_KM", "SECS_100M", etc.
   */
  private formatPaceValue(pace: number, units: string): string {
    if (units === 'MINS_KM') {
      // pace is in minutes per km (e.g., 4 = 4:00/km)
      const minutes = Math.floor(pace);
      const seconds = Math.round((pace - minutes) * 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
    } else if (units === 'SECS_100M') {
      // pace is in seconds per 100m (e.g., 120 = 2:00/100m)
      const minutes = Math.floor(pace / 60);
      const seconds = Math.round(pace % 60);
      if (minutes > 0) {
        return `${minutes}:${seconds.toString().padStart(2, '0')}/100m`;
      }
      return `${seconds}s/100m`;
    }
    // Default: just return the raw value
    return `${pace.toFixed(2)} ${units}`;
  }

  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Intervals.icu API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get completed activities within a date range
   */
  async getActivities(
    startDate: string,
    endDate: string,
    sport?: string
  ): Promise<NormalizedWorkout[]> {
    const activities = await this.fetch<IntervalsActivity[]>('/activities', {
      oldest: startDate,
      newest: endDate,
    });

    let filtered = activities;
    if (sport) {
      const normalizedSport = normalizeActivityType(sport);
      filtered = activities.filter(
        (a) => normalizeActivityType(a.type) === normalizedSport
      );
    }

    return filtered.map((a) => this.normalizeActivity(a));
  }

  /**
   * Get a single activity by ID
   */
  async getActivity(activityId: string): Promise<NormalizedWorkout> {
    const activity = await this.fetch<IntervalsActivity>(`/activities/${activityId}`);
    return this.normalizeActivity(activity);
  }

  /**
   * Get fitness metrics (CTL/ATL/TSB) for a date range
   */
  async getFitnessMetrics(
    startDate: string,
    endDate: string
  ): Promise<FitnessMetrics[]> {
    const wellness = await this.fetch<IntervalsWellness[]>('/wellness', {
      oldest: startDate,
      newest: endDate,
    });

    return wellness.map((w) => ({
      date: w.id, // id is the date in YYYY-MM-DD format
      ctl: w.ctl,
      atl: w.atl,
      tsb: w.ctl - w.atl, // Training Stress Balance = CTL - ATL
      ramp_rate: w.rampRate,
    }));
  }

  /**
   * Get planned events/workouts from calendar
   */
  async getPlannedEvents(
    startDate: string,
    endDate: string
  ): Promise<PlannedWorkout[]> {
    const events = await this.fetch<IntervalsEvent[]>('/events', {
      oldest: startDate,
      newest: endDate,
    });

    // Filter to only planned workouts (not completed activities)
    const plannedEvents = events.filter(
      (e) => e.category === 'WORKOUT' || e.category === 'RACE' || e.category === 'NOTE'
    );

    return plannedEvents.map((e) => this.normalizePlannedEvent(e));
  }

  /**
   * Get today's fitness metrics
   */
  async getTodayFitness(): Promise<FitnessMetrics | null> {
    const today = new Date().toISOString().split('T')[0];
    const metrics = await this.getFitnessMetrics(today, today);
    return metrics.length > 0 ? metrics[0] : null;
  }

  private normalizeActivity(activity: IntervalsActivity): NormalizedWorkout {
    // Calculate coasting percentage if we have both values
    const coastingPercentage =
      activity.coasting_time && activity.moving_time
        ? (activity.coasting_time / activity.moving_time) * 100
        : undefined;

    // Convert speed from m/s to km/h
    const avgSpeedKph = activity.average_speed
      ? activity.average_speed * 3.6
      : undefined;
    const maxSpeedKph = activity.max_speed
      ? activity.max_speed * 3.6
      : undefined;

    // Convert GAP from sec/m to sec/km if available
    const gapSecPerKm = activity.gap ? activity.gap * 1000 : undefined;

    // Normalize power zone times to our format
    const powerZoneTimes = activity.icu_zone_times?.map((zt) => ({
      zone_id: zt.id,
      seconds: zt.secs,
    }));

    return {
      id: activity.id,
      date: activity.start_date_local,
      start_date_utc: activity.start_date, // UTC for cross-platform matching
      activity_type: normalizeActivityType(activity.type),
      name: activity.name,
      description: activity.description,
      duration_seconds: activity.moving_time ?? activity.elapsed_time ?? 0,
      distance_km: activity.distance ? activity.distance / 1000 : undefined,
      tss: activity.icu_training_load,
      normalized_power: activity.weighted_avg_watts,
      average_power: activity.average_watts,
      average_heart_rate: activity.average_heartrate,
      max_heart_rate: activity.max_heartrate,
      intensity_factor: activity.icu_intensity,
      elevation_gain_m: activity.total_elevation_gain,
      calories: activity.calories,
      source: 'intervals.icu',

      // Speed metrics
      average_speed_kph: avgSpeedKph,
      max_speed_kph: maxSpeedKph,

      // Coasting
      coasting_time_seconds: activity.coasting_time,
      coasting_percentage: coastingPercentage,

      // Training load & feel
      load: activity.icu_training_load,
      rpe: this.pickHighestRpe(activity.rpe, activity.icu_rpe),
      feel: activity.feel,

      // Classification
      workout_class: activity.workout_doc?.class,

      // HR metrics
      hrrc: activity.hrrc,
      trimp: activity.trimp,

      // Power efficiency
      variability_index: activity.variability_index,
      power_hr_ratio: activity.decoupling,
      efficiency_factor: activity.efficiency_factor,

      // Fitness snapshot
      ctl_at_activity: activity.ctl,
      atl_at_activity: activity.atl,
      tsb_at_activity:
        activity.ctl !== undefined && activity.atl !== undefined
          ? activity.ctl - activity.atl
          : undefined,

      // Cadence
      average_cadence: activity.average_cadence,
      max_cadence: activity.max_cadence,

      // Thresholds
      ftp: activity.icu_ftp,
      eftp: activity.icu_eftp,
      activity_eftp: activity.icu_pm_ftp,

      // Energy
      work_kj: activity.joules ? activity.joules / 1000 : undefined,
      cho_used_g: activity.carbs_used,
      cho_intake_g: activity.carbs_ingested,

      // Intervals/laps count
      intervals_count: activity.icu_intervals?.length,
      laps_count: activity.icu_lap_count ?? activity.laps?.length,

      // Activity context flags
      is_indoor: activity.trainer,
      is_commute: activity.commute,
      is_race: activity.race,

      // Zone thresholds
      hr_zones: activity.icu_hr_zones,
      power_zones: activity.icu_power_zones,
      pace_zones: activity.pace_zones,

      // Time in zones
      power_zone_times: powerZoneTimes,
      hr_zone_times: activity.icu_hr_zone_times,
      pace_zone_times: activity.pace_zone_times,

      // Advanced power metrics
      joules_above_ftp: activity.icu_joules_above_ftp,
      max_wbal_depletion: activity.icu_max_wbal_depletion,
      polarization_index: activity.polarization_index,

      // Running/pace metrics
      average_stride_m: activity.average_stride,
      gap: gapSecPerKm,

      // Altitude
      average_altitude_m: activity.average_altitude,
      min_altitude_m: activity.min_altitude,
      max_altitude_m: activity.max_altitude,

      // Temperature
      average_temp_c: activity.average_temp,
      min_temp_c: activity.min_temp,
      max_temp_c: activity.max_temp,

      // Session metrics
      session_rpe: activity.session_rpe,
      strain_score: activity.strain_score,

      // Device info
      device_name: activity.device_name,
      power_meter: activity.power_meter,
    };
  }

  /**
   * Pick the highest RPE value from multiple sources.
   * Returns undefined if neither is present.
   */
  private pickHighestRpe(rpe?: number, icuRpe?: number): number | undefined {
    if (rpe !== undefined && icuRpe !== undefined) {
      return Math.max(rpe, icuRpe);
    }
    return icuRpe ?? rpe;
  }

  private normalizePlannedEvent(event: IntervalsEvent): PlannedWorkout {
    return {
      id: event.uid ?? String(event.id),
      date: event.start_date_local,
      name: event.name,
      description: event.description,
      expected_tss: event.icu_training_load,
      expected_if: event.icu_intensity,
      expected_duration_minutes: event.moving_time
        ? Math.round(event.moving_time / 60)
        : event.duration,
      workout_type: event.type,
      source: 'intervals.icu',
    };
  }

  // ============================================
  // Training Load Trends
  // ============================================

  /**
   * Get training load trends (CTL/ATL/TSB over time)
   * @param days - Number of days of history
   */
  async getTrainingLoadTrends(days: number = 42): Promise<TrainingLoadTrends> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const wellness = await this.fetch<IntervalsWellness[]>('/wellness', {
      oldest: startDate,
      newest: endDate,
    });

    const data: DailyTrainingLoad[] = wellness.map((w) => ({
      date: w.id, // id is the date in YYYY-MM-DD format
      ctl: w.ctl,
      atl: w.atl,
      tsb: w.ctl - w.atl,
      ramp_rate: w.rampRate,
      daily_tss: w.load,
    }));

    // Calculate summary
    const summary = this.calculateTrainingLoadSummary(data);

    return {
      period_days: days,
      sport: 'all',
      data,
      summary,
    };
  }

  private calculateTrainingLoadSummary(
    data: DailyTrainingLoad[]
  ): TrainingLoadSummary {
    if (data.length === 0) {
      return {
        current_ctl: 0,
        current_atl: 0,
        current_tsb: 0,
        ctl_trend: 'stable',
        avg_ramp_rate: 0,
        peak_ctl: 0,
        peak_ctl_date: '',
        acwr: 0,
        acwr_status: 'low_risk',
      };
    }

    const latest = data[data.length - 1];
    const currentCtl = latest.ctl;
    const currentAtl = latest.atl;
    const currentTsb = latest.tsb;

    // Calculate CTL trend (compare last 7 days vs previous 7)
    let ctlTrend: CTLTrend = 'stable';
    if (data.length >= 14) {
      const recent7 = data.slice(-7);
      const previous7 = data.slice(-14, -7);
      const recentAvg =
        recent7.reduce((sum, d) => sum + d.ctl, 0) / recent7.length;
      const previousAvg =
        previous7.reduce((sum, d) => sum + d.ctl, 0) / previous7.length;
      const diff = recentAvg - previousAvg;
      if (diff > 2) ctlTrend = 'increasing';
      else if (diff < -2) ctlTrend = 'decreasing';
    }

    // Average ramp rate
    const rampRates = data
      .filter((d) => d.ramp_rate !== undefined)
      .map((d) => d.ramp_rate!);
    const avgRampRate =
      rampRates.length > 0
        ? rampRates.reduce((sum, r) => sum + r, 0) / rampRates.length
        : 0;

    // Peak CTL
    let peakCtl = 0;
    let peakCtlDate = '';
    for (const d of data) {
      if (d.ctl > peakCtl) {
        peakCtl = d.ctl;
        peakCtlDate = d.date;
      }
    }

    // ACWR (Acute:Chronic Workload Ratio)
    const acwr = currentCtl > 0 ? currentAtl / currentCtl : 0;

    // Determine ACWR status
    let acwrStatus: ACWRStatus;
    if (acwr < 0.8) {
      acwrStatus = 'low_risk'; // Undertrained
    } else if (acwr <= 1.3) {
      acwrStatus = 'optimal'; // Sweet spot
    } else if (acwr <= 1.5) {
      acwrStatus = 'caution'; // Getting risky
    } else {
      acwrStatus = 'high_risk'; // Injury risk
    }

    return {
      current_ctl: Math.round(currentCtl * 10) / 10,
      current_atl: Math.round(currentAtl * 10) / 10,
      current_tsb: Math.round(currentTsb * 10) / 10,
      ctl_trend: ctlTrend,
      avg_ramp_rate: Math.round(avgRampRate * 10) / 10,
      peak_ctl: Math.round(peakCtl * 10) / 10,
      peak_ctl_date: peakCtlDate,
      acwr: Math.round(acwr * 100) / 100,
      acwr_status: acwrStatus,
    };
  }
}
