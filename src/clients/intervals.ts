import type {
  NormalizedWorkout,
  FitnessMetrics,
  PlannedWorkout,
  IntervalsConfig,
  AthleteProfile,
  SportSettings,
  TrainingZone,
  PowerCurve,
  PowerCurvePoint,
  PaceCurve,
  PaceCurvePoint,
  DailyTrainingLoad,
  TrainingLoadTrends,
  TrainingLoadSummary,
  CTLTrend,
  ACWRStatus,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

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
  id: string;
  date: string;
  ctl: number;
  atl: number;
  rampRate?: number;
  load?: number; // daily training load
}

// Athlete profile response
interface IntervalsAthlete {
  id: string;
  name?: string;
  weight?: number;
  sportSettings?: IntervalsSportSettings[];
}

interface IntervalsSportSettings {
  id?: number;
  type: string; // "Ride", "Run", "Swim"
  ftp?: number;
  indoor_ftp?: number;
  icu_eftp?: number;
  lthr?: number;
  max_hr?: number;
  resting_hr?: number;
  threshold_pace?: number;
  w_prime?: number;
  pmax?: number;
  weight?: number;

  power_zones?: Array<{
    id: number;
    name: string;
    min: number;
    max: number;
    color?: string;
  }>;

  hr_zones?: Array<{
    id: number;
    name: string;
    min: number;
    max: number;
  }>;

  pace_zones?: Array<{
    id: number;
    name: string;
    min: number;
    max: number;
  }>;
}

// Power curve response
interface IntervalsPowerCurve {
  secs: number[];
  watts: number[];
  wattsPerKg?: number[];
  dates?: string[];
}

// Pace curve response
interface IntervalsPaceCurve {
  secs: number[];
  value: number[]; // pace in seconds/meter
  dates?: string[];
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

  constructor(config: IntervalsConfig) {
    this.config = config;
    // Intervals.icu uses API key as password with "API_KEY" as username
    const credentials = Buffer.from(`API_KEY:${config.apiKey}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
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
      date: w.date,
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
  // Athlete Profile
  // ============================================

  /**
   * Get athlete profile including sport settings, zones, and thresholds
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    const athlete = await this.fetch<IntervalsAthlete>('');

    const sports: SportSettings[] = (athlete.sportSettings ?? []).map(
      (settings) => this.normalizeSportSettings(settings)
    );

    // Find primary cycling sport for default values
    const cyclingSport = sports.find(
      (s) =>
        s.sport_type === 'Ride' ||
        s.sport_type?.toLowerCase().includes('cycling')
    );

    return {
      athlete_id: this.config.athleteId,
      name: athlete.name,
      weight_kg: athlete.weight,
      sports,
      primary_ftp: cyclingSport?.ftp,
      primary_lthr: cyclingSport?.lthr,
      primary_max_hr: cyclingSport?.max_hr,
    };
  }

  private normalizeSportSettings(
    settings: IntervalsSportSettings
  ): SportSettings {
    return {
      sport_type: settings.type,
      ftp: settings.ftp,
      indoor_ftp: settings.indoor_ftp,
      eftp: settings.icu_eftp,
      w_prime: settings.w_prime,
      pmax: settings.pmax,
      lthr: settings.lthr,
      max_hr: settings.max_hr,
      resting_hr: settings.resting_hr,
      threshold_pace: settings.threshold_pace,
      weight_kg: settings.weight,

      power_zones: settings.power_zones?.map((z, i) => ({
        zone_number: i + 1,
        name: z.name,
        min_value: z.min,
        max_value: z.max === 0 ? null : z.max,
        color: z.color,
      })),

      heart_rate_zones: settings.hr_zones?.map((z, i) => ({
        zone_number: i + 1,
        name: z.name,
        min_value: z.min,
        max_value: z.max === 0 ? null : z.max,
      })),

      pace_zones: settings.pace_zones?.map((z, i) => ({
        zone_number: i + 1,
        name: z.name,
        min_value: z.min,
        max_value: z.max === 0 ? null : z.max,
      })),
    };
  }

  // ============================================
  // Power Curves
  // ============================================

  /**
   * Get power curve (best efforts at various durations)
   * @param sport - Sport type, defaults to 'Ride'
   * @param period - Time period: '42d', '90d', '1y', 'all'
   */
  async getPowerCurve(
    sport: string = 'Ride',
    period: string = '90d'
  ): Promise<PowerCurve> {
    const data = await this.fetch<IntervalsPowerCurve>('/power-curves', {
      curves: period,
      type: sport,
    });

    // Build curve points from parallel arrays
    const curve: PowerCurvePoint[] = data.secs.map((sec, i) => ({
      duration_seconds: sec,
      watts: data.watts[i],
      watts_per_kg: data.wattsPerKg?.[i],
      date: data.dates?.[i],
    }));

    // Extract key durations
    const findWattsAtDuration = (targetSecs: number): number | undefined => {
      const idx = data.secs.indexOf(targetSecs);
      return idx >= 0 ? data.watts[idx] : undefined;
    };

    // Get athlete weight for context
    let athleteWeight: number | undefined;
    let athleteFtp: number | undefined;
    try {
      const profile = await this.getAthleteProfile();
      athleteWeight = profile.weight_kg;
      athleteFtp = profile.primary_ftp;
    } catch {
      // Ignore if profile fetch fails
    }

    return {
      sport,
      period,
      athlete_ftp: athleteFtp,
      athlete_weight_kg: athleteWeight,
      curve,
      peak_5s: findWattsAtDuration(5),
      peak_1min: findWattsAtDuration(60),
      peak_5min: findWattsAtDuration(300),
      peak_20min: findWattsAtDuration(1200),
      peak_60min: findWattsAtDuration(3600),
    };
  }

  // ============================================
  // Pace Curves
  // ============================================

  /**
   * Get pace curve (best paces at various durations)
   * @param period - Time period: '42d', '90d', '1y', 'all'
   * @param gap - Use gradient-adjusted pace
   */
  async getPaceCurve(
    period: string = '90d',
    gap: boolean = false
  ): Promise<PaceCurve> {
    const params: Record<string, string> = {
      curves: period,
      type: 'Run',
    };
    if (gap) {
      params.gap = 'true';
    }

    const data = await this.fetch<IntervalsPaceCurve>('/pace-curves', params);

    // Convert pace from sec/meter to sec/km and speed to km/h
    const curve: PaceCurvePoint[] = data.secs.map((sec, i) => {
      const paceSecPerMeter = data.value[i];
      const paceSecPerKm = paceSecPerMeter * 1000;
      const speedKph = 3600 / paceSecPerKm;

      return {
        duration_seconds: sec,
        pace_per_km: paceSecPerKm,
        speed_kph: speedKph,
        date: data.dates?.[i],
      };
    });

    // Helper to find pace at specific duration
    const findPaceAtDuration = (targetSecs: number): number | undefined => {
      const idx = data.secs.indexOf(targetSecs);
      if (idx < 0) return undefined;
      return data.value[idx] * 1000; // Convert to sec/km
    };

    return {
      period,
      gradient_adjusted: gap,
      curve,
      // Approximate durations for common race distances (at typical paces)
      peak_400m_pace: findPaceAtDuration(60), // ~1min effort
      peak_1km_pace: findPaceAtDuration(180), // ~3min effort
      peak_5km_pace: findPaceAtDuration(1200), // ~20min effort
      peak_10km_pace: findPaceAtDuration(2400), // ~40min effort
      peak_half_marathon_pace: findPaceAtDuration(5400), // ~90min effort
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
      date: w.date,
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
