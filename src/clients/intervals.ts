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
  SportSettingsResponse,
  UnitPreferences,
  HRZone,
  PowerZone,
  PaceZone,
  HeatZone,
  ZoneTime,
  WorkoutInterval,
  IntervalGroup,
  WorkoutIntervalsResponse,
  WorkoutNote,
  WorkoutNotesResponse,
  PowerCurvePoint,
  ActivityPowerCurve,
  PaceCurvePoint,
  ActivityPaceCurve,
  HRCurvePoint,
  ActivityHRCurve,
  WellnessData,
  DailyWellness,
  WellnessTrends,
  ActivityType,
  ActivityIntervalInput,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import {
  formatDuration,
  formatDistance,
  formatSpeed,
  formatPace,
  isSwimmingActivity,
} from '../utils/format-units.js';
import { getTodayInTimezone } from '../utils/date-parser.js';
import { localStringToISO8601WithTimezone } from '../utils/date-formatting.js';
import {
  calculateHeatMetrics,
  parseHeatStrainStreams,
} from '../utils/heat-zones.js';
import {
  calculateTemperatureMetrics,
  parseTemperatureStreams,
} from '../utils/temperature-metrics.js';
import { IntervalsApiError } from '../errors/index.js';

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

// Athlete data from root /athlete/{id} endpoint
// Note: /profile endpoint has nested { athlete: { ... } } structure, but root endpoint is flat
interface IntervalsAthleteData {
  id: string;
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  sex?: string;
  // Unit preferences (only available at root endpoint, not /profile)
  measurement_preference?: 'meters' | 'feet'; // "meters" = metric, "feet" = imperial
  weight_pref_lb?: boolean; // true = use pounds for weight regardless of measurement_preference
  fahrenheit?: boolean; // true = use Fahrenheit regardless of measurement_preference
  // Date of birth (only available at root endpoint, not /profile)
  icu_date_of_birth?: string; // ISO date (YYYY-MM-DD)
}

// Profile endpoint returns nested structure (used for timezone caching)
interface IntervalsAthleteProfile {
  athlete: {
    id: string;
    timezone?: string;
  };
}

// Sport settings from /sport-settings endpoint
interface IntervalsSportSettings {
  id: number;
  athlete_id: string;
  types: string[];
  ftp?: number;
  indoor_ftp?: number;
  sweet_spot_min?: number;
  sweet_spot_max?: number;
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

  // Threshold pace for this activity
  threshold_pace?: number; // Speed in m/s (needs conversion based on pace_units)
  pace_units?: string; // "MINS_KM", "SECS_100M", etc.

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
  strain_score?: number; // Intervals.icu strain score (XSS-like)

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

  // Power efficiency (API returns both prefixed and non-prefixed depending on endpoint)
  variability_index?: number;
  icu_variability_index?: number;
  decoupling?: number;
  efficiency_factor?: number;
  icu_efficiency_factor?: number;

  // Fitness at activity time (API returns both prefixed and non-prefixed depending on endpoint)
  ctl?: number;
  atl?: number;
  icu_ctl?: number;
  icu_atl?: number;

  // Cadence
  average_cadence?: number;
  max_cadence?: number;

  // Thresholds for this activity
  icu_ftp?: number;
  icu_eftp?: number;
  icu_pm_ftp?: number; // activity-derived eFTP
  lthr?: number; // Lactate threshold HR at time of activity

  // Energy (API returns both prefixed and non-prefixed depending on endpoint)
  joules?: number;
  icu_joules?: number;
  carbs_used?: number;
  carbs_ingested?: number;

  // Power metrics (API returns both prefixed and non-prefixed depending on endpoint)
  weighted_avg_watts?: number;
  icu_weighted_avg_watts?: number;
  average_watts?: number;
  icu_average_watts?: number;

  // Athlete metrics at time of activity
  icu_weight?: number; // Weight in kg
  icu_resting_hr?: number; // Resting HR

  // Source information
  source?: string; // e.g., "Zwift", "Garmin", etc.
  external_id?: string; // External ID from the source platform (e.g., Garmin, Zwift)
  strava_id?: string; // Strava activity ID if synced from Strava

  // API availability note (present when activity data is not available)
  _note?: string; // e.g., "STRAVA activities are not available via the API"

  // Stream types available for this activity
  stream_types?: string[]; // e.g., ["time", "watts", "heartrate", "temp", "heat_strain_index"]
}

interface IntervalsWellness {
  id: string; // Date in YYYY-MM-DD format (used as primary key)
  ctl: number;
  atl: number;
  rampRate?: number;
  ctlLoad?: number; // Weighted contribution to CTL from this day's training
  atlLoad?: number; // Weighted contribution to ATL from this day's training
  weight?: number; // Weight in kilograms

  // Heart rate and HRV
  restingHR?: number;
  hrv?: number; // rMSSD in milliseconds
  hrvSDNN?: number; // SDNN in milliseconds

  // Menstrual cycle
  menstrualPhase?: string;
  menstrualPhasePredicted?: string;

  // Nutrition
  kcalConsumed?: number;

  // Sleep
  sleepSecs?: number;
  sleepScore?: number;
  sleepQuality?: number; // 1=GREAT, 2=GOOD, 3=AVG, 4=POOR
  avgSleepingHR?: number;

  // Subjective metrics (1-4 scale)
  soreness?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  fatigue?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  stress?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  mood?: number; // 1=GREAT, 2=GOOD, 3=OK, 4=GRUMPY
  motivation?: number; // 1=EXTREME, 2=HIGH, 3=AVG, 4=LOW
  injury?: number; // 1=NONE, 2=NIGGLE, 3=POOR, 4=INJURED
  hydration?: number; // 1=GOOD, 2=OK, 3=POOR, 4=BAD

  // Vitals
  spO2?: number;
  systolic?: number;
  diastolic?: number;
  hydrationVolume?: number;
  respiration?: number;

  // Readiness and body composition
  readiness?: number;
  baevskySI?: number;
  bloodGlucose?: number;
  lactate?: number;
  bodyFat?: number;
  abdomen?: number;
  vo2max?: number;

  // Activity and notes
  steps?: number;
  comments?: string;
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
  tags?: string[];
  external_id?: string;
}

/**
 * Input for creating an event in Intervals.icu.
 */
export interface CreateEventInput {
  /** Workout name */
  name: string;
  /** Description/notes - can include structured workout syntax */
  description?: string;
  /** Event type (e.g., "Run", "Ride") */
  type: string;
  /** Category - should be "WORKOUT" for workouts */
  category: 'WORKOUT' | 'NOTE' | 'RACE' | 'OTHER';
  /** Start date in YYYY-MM-DD or datetime format */
  start_date_local: string;
  /** Duration in seconds */
  moving_time?: number;
  /** Training load (TSS) */
  icu_training_load?: number;
  /** Tags for tracking */
  tags?: string[];
  /** External ID for linking to source (e.g., TrainerRoad UID) */
  external_id?: string;
}

/**
 * Response from event creation.
 */
export interface CreateEventResponse {
  id: number;
  uid: string;
  name: string;
  start_date_local: string;
  type: string;
  category: string;
  tags?: string[];
  external_id?: string;
}

/**
 * Input for updating an event in Intervals.icu.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateEventInput {
  /** Workout name */
  name?: string;
  /** Description/notes - can include structured workout syntax */
  description?: string;
  /** Event type (e.g., "Run", "Ride") */
  type?: string;
  /** Category - should be "WORKOUT" for workouts */
  category?: 'WORKOUT' | 'NOTE' | 'RACE' | 'OTHER';
  /** Start date in YYYY-MM-DD or datetime format */
  start_date_local?: string;
  /** Duration in seconds */
  moving_time?: number;
  /** Training load (TSS) */
  icu_training_load?: number;
  /** Tags for tracking */
  tags?: string[];
  /** External ID for linking to source (e.g., TrainerRoad UID) */
  external_id?: string;
}

/**
 * Response from event update.
 */
export interface UpdateEventResponse {
  id: number;
  uid: string;
  name: string;
  start_date_local: string;
  type: string;
  category: string;
  tags?: string[];
  external_id?: string;
}

// Raw interval from Intervals.icu API
interface IntervalsRawInterval {
    id: number;
  type: 'WORK' | 'RECOVERY';
  label?: string;
  group_id?: string;
  start_time: number;
  end_time: number;
  moving_time: number;
  distance: number;
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  average_watts_kg?: number;
  zone?: number;
  intensity?: number;
  training_load?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  decoupling?: number;
  average_cadence?: number;
  average_stride?: number;
  average_speed?: number;
  total_elevation_gain?: number;
  average_gradient?: number;
  wbal_start?: number;
  wbal_end?: number;
  joules_above_ftp?: number;
}

// Raw interval group from Intervals.icu API
interface IntervalsRawGroup {
  id: string;
  count: number;
  average_watts?: number;
  average_heartrate?: number;
  average_cadence?: number;
  average_speed?: number;
  distance?: number;
  moving_time?: number;
  total_elevation_gain?: number;
}

// API response for activity intervals
interface IntervalsActivityIntervalsResponse {
  id: string;
  icu_intervals: IntervalsRawInterval[];
  icu_groups: IntervalsRawGroup[];
}

// Raw message/note from Intervals.icu API
interface IntervalsRawMessage {
  id: number;
  athlete_id: string;
  name: string;
  created: string;
  type: string;
  content: string;
  deleted: string | null;
  attachment_url?: string | null;
  attachment_mime_type?: string | null;
}

// ============================================
// Raw API response types for performance curves
// ============================================

interface RawActivityPowerCurve {
  id: string;
  start_date_local: string;
  weight: number;
  watts: number[];
}

interface RawPowerCurvesResponse {
  after_kj: number;
  secs: number[];
  curves: RawActivityPowerCurve[];
}

interface RawActivityPaceCurve {
  id: string;
  start_date_local: string;
  weight: number;
  secs: number[]; // Time to cover each distance
}

interface RawPaceCurvesResponse {
  distances: number[]; // meters
  gap: boolean;
  curves: RawActivityPaceCurve[];
}

interface RawActivityHRCurve {
  id: string;
  start_date_local: string;
  weight: number;
  bpm: number[];
}

interface RawHRCurvesResponse {
  secs: number[];
  curves: RawActivityHRCurve[];
}

export class IntervalsClient {
  private config: IntervalsConfig;
  private authHeader: string;
  private cachedTimezone: string | null = null;
  private cachedSportSettings: IntervalsSportSettings[] | null = null;
  private cachedUnitPreferences: UnitPreferences | null = null;

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
   * Get sport settings (cached after first fetch).
   */
  private async getSportSettings(): Promise<IntervalsSportSettings[]> {
    if (this.cachedSportSettings) {
      return this.cachedSportSettings;
    }

    this.cachedSportSettings = await this.fetch<IntervalsSportSettings[]>('/sport-settings');
    return this.cachedSportSettings;
  }

  /**
   * Compute unit preferences from raw API values.
   * @param measurementPreference - "meters" (metric) or "feet" (imperial)
   * @param weightPrefLb - true = use pounds for weight regardless of measurement_preference
   * @param fahrenheit - true = use Fahrenheit regardless of measurement_preference
   */
  private computeUnitPreferences(
    measurementPreference: 'meters' | 'feet' | undefined,
    weightPrefLb: boolean | undefined,
    fahrenheit: boolean | undefined
  ): UnitPreferences {
    // Default to metric if not specified
    const isMetric = measurementPreference !== 'feet';
    const system = isMetric ? 'metric' : 'imperial';

    // Weight: use lb if explicitly set, otherwise follow system preference
    const weight = weightPrefLb ? 'lb' : (isMetric ? 'kg' : 'lb');

    // Temperature: use fahrenheit if explicitly set, otherwise follow system preference
    const temperature = fahrenheit ? 'fahrenheit' : (isMetric ? 'celsius' : 'fahrenheit');

    return { system, weight, temperature };
  }

  /**
   * Calculate age from date of birth.
   * @param dateOfBirth - ISO date string (YYYY-MM-DD)
   * @returns Age in years, or undefined if dateOfBirth is not provided
   */
  private calculateAge(dateOfBirth: string | undefined): number | undefined {
    if (!dateOfBirth) {
      return undefined;
    }

    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  /**
   * Get the athlete's unit preferences.
   * Result is cached after first fetch.
   * Uses root athlete endpoint which has unit preference fields.
   */
  async getUnitPreferences(): Promise<UnitPreferences> {
    if (this.cachedUnitPreferences) {
      return this.cachedUnitPreferences;
    }

    // Use root endpoint (empty string) which has unit preference fields
    const athlete = await this.fetch<IntervalsAthleteData>('');
    this.cachedUnitPreferences = this.computeUnitPreferences(
      athlete.measurement_preference,
      athlete.weight_pref_lb,
      athlete.fahrenheit
    );
    return this.cachedUnitPreferences;
  }

  /**
   * Get the complete athlete profile.
   * Note: Sport-specific settings are now retrieved via getSportSettingsForSport().
   * Uses root athlete endpoint which has unit preferences and DOB.
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    // Use root endpoint (empty string) which has all fields including DOB and unit prefs
    const athlete = await this.fetch<IntervalsAthleteData>('');

    // Compute and cache unit preferences
    const unitPreferences = this.computeUnitPreferences(
      athlete.measurement_preference,
      athlete.weight_pref_lb,
      athlete.fahrenheit
    );
    this.cachedUnitPreferences = unitPreferences;

    // Calculate age if date of birth is set
    const age = this.calculateAge(athlete.icu_date_of_birth);

    const result: AthleteProfile = {
      id: athlete.id,
      name: athlete.name,
      city: athlete.city,
      state: athlete.state,
      country: athlete.country,
      timezone: athlete.timezone,
      sex: athlete.sex,
      unit_preferences: unitPreferences,
    };

    // Only include date_of_birth and age if DOB is set
    if (athlete.icu_date_of_birth) {
      result.date_of_birth = athlete.icu_date_of_birth;
      result.age = age;
    }

    return result;
  }

  /**
   * Get sport settings for a specific sport.
   * @param sport - "cycling", "running", or "swimming"
   * @returns Sport settings, or null if not found
   */
  async getSportSettingsForSport(sport: 'cycling' | 'running' | 'swimming'): Promise<SportSettingsResponse | null> {
    // Map sport names to Intervals.icu activity types
    const sportTypeMap: Record<string, string[]> = {
      cycling: ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'],
      running: ['Run', 'VirtualRun', 'TrailRun'],
      swimming: ['Swim', 'OpenWaterSwim'],
    };

    const activityTypes = sportTypeMap[sport];
    if (!activityTypes) {
      return null;
    }

    const sportSettings = await this.getSportSettings();

    // Find the first sport settings that matches any of the activity types
    for (const settings of sportSettings) {
      if (settings.types.some(t => activityTypes.includes(t))) {
        const normalized = this.normalizeSportSettings(settings);

        return {
          sport,
          types: settings.types,
          settings: normalized,
        };
      }
    }

    return null;
  }

  /**
   * Find sport settings matching an activity type.
   * Returns the first matching sport settings or null if not found.
   */
  private findMatchingSportSettings(
    activityType: string | undefined,
    sportSettings: IntervalsSportSettings[]
  ): IntervalsSportSettings | null {
    if (!activityType) {
      return null;
    }

    // Normalize activity type for matching (e.g., "VirtualRide" → "Ride")
    const normalizedType = activityType.replace(/^Virtual/, '');

    for (const settings of sportSettings) {
      // Check if activity type matches any of the types in this sport setting
      if (settings.types.some((t) => t === activityType || t === normalizedType)) {
        return settings;
      }
    }

    return null;
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

    // Sweet spot
    if (settings.sweet_spot_min !== undefined) {
      result.sweet_spot_min = settings.sweet_spot_min;
    }
    if (settings.sweet_spot_max !== undefined) {
      result.sweet_spot_max = settings.sweet_spot_max;
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
      result.threshold_pace = this.formatPaceValue(paceValue, settings.pace_units);
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
      const slowPaceValue = lowPercent > 0 ? thresholdPace / (lowPercent / 100) : null;
      const fastPaceValue = highPercent ? thresholdPace / (highPercent / 100) : null;

      result.push({
        name: names[i],
        low_percent: lowPercent,
        high_percent: highPercent,
        slow_pace: slowPaceValue ? this.formatPaceValue(slowPaceValue, paceUnits) : null,
        fast_pace: fastPaceValue ? this.formatPaceValue(fastPaceValue, paceUnits) : null,
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

  /**
   * Normalize HR zones for an activity using zone boundaries from the activity
   * and zone names from sport settings.
   */
  private normalizeActivityHRZones(
    zoneBoundaries: number[] | undefined,
    zoneNames: string[] | undefined,
    maxHR: number | undefined,
    zoneTimes: number[] | undefined
  ): HRZone[] | undefined {
    if (!zoneBoundaries || !zoneNames) {
      return undefined;
    }

    const zones = this.mergeHRZones(zoneBoundaries, zoneNames, maxHR);

    // Merge in time data if available
    if (zoneTimes) {
      zones.forEach((zone, index) => {
        if (index < zoneTimes.length) {
          zone.time_in_zone = formatDuration(zoneTimes[index]);
        }
      });
    }

    return zones;
  }

  /**
   * Normalize power zones for an activity using zone boundaries from the activity
   * and zone names from sport settings.
   */
  private normalizeActivityPowerZones(
    zoneBoundaries: number[] | undefined,
    zoneNames: string[] | undefined,
    ftp: number | undefined,
    zoneTimes: ZoneTime[] | undefined,
    sweetSpotMin: number | undefined,
    sweetSpotMax: number | undefined
  ): PowerZone[] | undefined {
    if (!zoneBoundaries || !zoneNames || !ftp) {
      return undefined;
    }

    const zones = this.mergePowerZones(zoneBoundaries, zoneNames, ftp);

    // Merge in time data if available
    if (zoneTimes) {
      // Create a map of zone_id to seconds for quick lookup
      const timeMap = new Map(zoneTimes.map(zt => [zt.zone_id, zt.seconds]));

      zones.forEach((zone, index) => {
        // Zone IDs are typically "Z1", "Z2", etc.
        const zoneId = `Z${index + 1}`;
        const seconds = timeMap.get(zoneId);
        if (seconds !== undefined) {
          zone.time_in_zone = formatDuration(seconds);
        }
      });

      // Add sweet spot zone if there's time in it
      const sweetSpotSeconds = timeMap.get('SS');
      if (sweetSpotSeconds && sweetSpotSeconds > 0 && sweetSpotMin !== undefined && sweetSpotMax !== undefined) {
        zones.push({
          name: 'Sweet Spot',
          low_percent: sweetSpotMin,
          high_percent: sweetSpotMax,
          low_watts: Math.round((sweetSpotMin / 100) * ftp),
          high_watts: Math.round((sweetSpotMax / 100) * ftp),
          time_in_zone: formatDuration(sweetSpotSeconds),
        });
      }
    }

    return zones;
  }

  /**
   * Normalize pace zones for an activity using zone boundaries from the activity
   * and zone names from sport settings.
   */
  private normalizeActivityPaceZones(
    zoneBoundaries: number[] | undefined,
    zoneNames: string[] | undefined,
    thresholdPace: number | undefined,
    paceUnits: string | undefined,
    zoneTimes: number[] | undefined
  ): PaceZone[] | undefined {
    if (!zoneBoundaries || !zoneNames || !thresholdPace || !paceUnits) {
      return undefined;
    }

    const zones = this.mergePaceZones(zoneBoundaries, zoneNames, thresholdPace, paceUnits);

    // Merge in time data if available
    if (zoneTimes) {
      zones.forEach((zone, index) => {
        if (index < zoneTimes.length) {
          zone.time_in_zone = formatDuration(zoneTimes[index]);
        }
      });
    }

    return zones;
  }

  private async fetch<T>(
    endpoint: string,
    params?: Record<string, string>,
    context?: { operation: string; resource?: string }
  ): Promise<T> {
    if (endpoint) {
      console.log(`[Intervals] Making API call to ${endpoint}`);
    } else {
      console.log(`[Intervals] Making API call`);
    }

    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const errorContext = context ?? {
      operation: `fetch ${endpoint}`,
      resource: undefined,
    };

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, {
          ...errorContext,
          parameters: params,
        });
      }

      return response.json() as Promise<T>;
    } catch (error) {
      // Re-throw if it's already our error type
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      // Network or other errors
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Fetch from activity-specific endpoints (uses /activity/{id} instead of /athlete/{id})
   */
  private async fetchActivity<T>(
    activityId: string,
    endpoint: string,
    context?: { operation: string }
  ): Promise<T> {
    console.log(`[Intervals] Making API call to /activity/${activityId}${endpoint}`);

    const url = new URL(`${INTERVALS_API_BASE}/activity/${activityId}${endpoint}`);

    const errorContext = {
      operation: context?.operation ?? `fetch activity ${endpoint}`,
      resource: `activity ${activityId}`,
    };

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, errorContext);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      // Re-throw if it's already our error type
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      // Network or other errors
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Get completed activities within a date range
   */
  async getActivities(
    startDate: string,
    endDate: string,
    sport?: string,
    options?: { skipExpensiveCalls?: boolean }
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

    // Pre-fetch sport settings to populate cache before parallel normalization
    // This avoids a race condition where all normalizeActivity calls try to fetch at once
    await this.getSportSettings();

    return Promise.all(filtered.map((a) => this.normalizeActivity(a, options)));
  }

  /**
   * Get a single activity by ID
   */
  async getActivity(activityId: string): Promise<NormalizedWorkout> {
    const activity = await this.fetch<IntervalsActivity>(`/activities/${activityId}`);
    return await this.normalizeActivity(activity);
  }

  /**
   * Get intervals for a specific activity
   */
  async getActivityIntervals(activityId: string): Promise<WorkoutIntervalsResponse> {
    const response = await this.fetchActivity<IntervalsActivityIntervalsResponse>(
      activityId,
      '/intervals'
    );

    // Fetch heat strain and temperature stream data if available
    let heatStreamData: { time: number[]; heat_strain_index: number[] } | null = null;
    let tempStreamData: { time: number[]; temp: number[] } | null = null;
    try {
      interface StreamData {
        type: string;
        data: number[];
      }
      const streams = await this.fetchActivity<StreamData[]>(
        activityId,
        '/streams?types=heat_strain_index&types=time&types=temp'
      );

      heatStreamData = parseHeatStrainStreams(streams);
      tempStreamData = parseTemperatureStreams(streams);
    } catch (error) {
      // Heat strain or temperature data may not be available for this activity
    }

    const intervals = (response.icu_intervals || []).map((i) =>
      this.normalizeInterval(i, heatStreamData, tempStreamData)
    );
    const groups = (response.icu_groups || []).map((g) =>
      this.normalizeIntervalGroup(g)
    );

    return {
      activity_id: activityId,
      intervals,
      groups,
    };
  }

  /**
   * Get notes/messages for a specific activity
   */
  async getActivityNotes(activityId: string): Promise<WorkoutNotesResponse> {
    const messages = await this.fetchActivity<IntervalsRawMessage[]>(
      activityId,
      '/messages'
    );

    // Filter out deleted messages, normalize, and sort chronologically (oldest first)
    const notes: WorkoutNote[] = (messages || [])
      .filter((m) => m.deleted === null)
      .map((m) => ({
        author: m.name,
        created: m.created,
        type: m.type,
        content: m.content,
        attachment_url: m.attachment_url ?? undefined,
        attachment_mime_type: m.attachment_mime_type ?? undefined,
      }))
      .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

    return {
      activity_id: activityId,
      notes,
    };
  }

  /**
   * Get weather summary for a specific activity.
   * Only relevant for outdoor activities.
   */
  async getActivityWeather(activityId: string): Promise<{ activity_id: string; weather_description: string | null }> {
    try {
      const response = await this.fetchActivity<{ description?: string }>(
        activityId,
        '/weather-summary'
      );

      let description = response.description ?? null;

      // Remove the "-- Intervals icu --\n" prefix if present
      if (description) {
        description = description.replace(/^-- Intervals icu --\n/i, '').trim();
      }

      return {
        activity_id: activityId,
        weather_description: description,
      };
    } catch (error) {
      // Weather data may not be available for all activities
      return {
        activity_id: activityId,
        weather_description: null,
      };
    }
  }

  /**
   * Get heat zones for a specific activity.
   * Returns null if heat strain data is not available.
   */
  async getActivityHeatZones(activityId: string): Promise<HeatZone[] | null> {
    try {
      const metrics = await this.getActivityHeatMetrics(activityId);
      return metrics?.zones ?? null;
    } catch (error) {
      // Heat strain data may not be available for all activities
      return null;
    }
  }

  /**
   * Get comprehensive heat metrics for a specific activity.
   * Returns null if heat strain data is not available.
   */
  async getActivityHeatMetrics(activityId: string): Promise<{
    zones: HeatZone[];
    max_heat_strain_index: number;
    median_heat_strain_index: number;
  } | null> {
    try {
      interface StreamData {
        type: string;
        data: number[];
      }

      const streams = await this.fetchActivity<StreamData[]>(
        activityId,
        '/streams?types=heat_strain_index&types=time'
      );

      const parsed = parseHeatStrainStreams(streams);
      if (!parsed) {
        return null;
      }

      return calculateHeatMetrics(parsed.time, parsed.heat_strain_index);
    } catch (error) {
      // Heat strain data may not be available for all activities
      return null;
    }
  }

  /**
   * Get ambient temperature metrics for a specific activity.
   * Returns null if temperature data is not available (e.g., indoor activities).
   */
  async getActivityTemperatureMetrics(activityId: string): Promise<{
    min_ambient_temperature: number;
    max_ambient_temperature: number;
    median_ambient_temperature: number;
    start_ambient_temperature: number;
    end_ambient_temperature: number;
  } | null> {
    try {
      interface StreamData {
        type: string;
        data: number[];
      }

      const streams = await this.fetchActivity<StreamData[]>(
        activityId,
        '/streams?types=temp&types=time'
      );

      const parsed = parseTemperatureStreams(streams);
      if (!parsed) {
        return null;
      }

      return calculateTemperatureMetrics(parsed.time, parsed.temp);
    } catch (error) {
      // Temperature data may not be available for all activities (e.g., indoor activities)
      return null;
    }
  }

  /**
   * Normalize a raw interval from the API
   */
  private normalizeInterval(
    raw: IntervalsRawInterval,
    heatStreamData: { time: number[]; heat_strain_index: number[] } | null = null,
    tempStreamData: { time: number[]; temp: number[] } | null = null
  ): WorkoutInterval {
    const distanceKm = raw.distance ? raw.distance / 1000 : undefined;
    const speedKph = raw.average_speed ? raw.average_speed * 3.6 : undefined;
    const elevationGain = raw.total_elevation_gain ? Math.round(raw.total_elevation_gain) : undefined;

    // Calculate heat metrics for this interval if heat data is available
    let heatMetrics:
      | {
          min_heat_strain_index: number;
          max_heat_strain_index: number;
          median_heat_strain_index: number;
          start_heat_strain_index: number;
          end_heat_strain_index: number;
        }
      | undefined;

    if (heatStreamData && heatStreamData.time.length > 0) {
      // Find indices in the stream data that fall within this interval's time range
      const intervalHSI: number[] = [];
      let startHSI: number | undefined;
      let endHSI: number | undefined;

      for (let i = 0; i < heatStreamData.time.length; i++) {
        const time = heatStreamData.time[i];
        const hsi = heatStreamData.heat_strain_index[i];

        if (time >= raw.start_time && time <= raw.end_time) {
          intervalHSI.push(hsi);

          // Capture start HSI (first data point in interval)
          if (startHSI === undefined) {
            startHSI = hsi;
          }
          // Keep updating end HSI (will be last data point in interval)
          endHSI = hsi;
        }
      }

      // Only include metrics if we found data points in this interval
      if (intervalHSI.length > 0) {
        const minHSI = Math.min(...intervalHSI);
        const maxHSI = Math.max(...intervalHSI);

        // Calculate median HSI
        const sorted = [...intervalHSI].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianHSI = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];

        heatMetrics = {
          min_heat_strain_index: Math.round(minHSI * 10) / 10,
          max_heat_strain_index: Math.round(maxHSI * 10) / 10,
          median_heat_strain_index: Math.round(medianHSI * 10) / 10,
          start_heat_strain_index: startHSI !== undefined ? Math.round(startHSI * 10) / 10 : 0,
          end_heat_strain_index: endHSI !== undefined ? Math.round(endHSI * 10) / 10 : 0,
        };
      }
    }

    // Calculate temperature metrics for this interval if temperature data is available
    let tempMetrics:
      | {
          min_ambient_temperature: number;
          max_ambient_temperature: number;
          median_ambient_temperature: number;
          start_ambient_temperature: number;
          end_ambient_temperature: number;
        }
      | undefined;

    if (tempStreamData && tempStreamData.time.length > 0) {
      // Find indices in the stream data that fall within this interval's time range
      const intervalTemp: number[] = [];
      let startTemp: number | undefined;
      let endTemp: number | undefined;

      for (let i = 0; i < tempStreamData.time.length; i++) {
        const time = tempStreamData.time[i];
        const temp = tempStreamData.temp[i];

        if (time >= raw.start_time && time <= raw.end_time) {
          intervalTemp.push(temp);

          // Capture start temp (first data point in interval)
          if (startTemp === undefined) {
            startTemp = temp;
          }
          // Keep updating end temp (will be last data point in interval)
          endTemp = temp;
        }
      }

      // Only include metrics if we found data points in this interval
      if (intervalTemp.length > 0) {
        const minTemp = Math.min(...intervalTemp);
        const maxTemp = Math.max(...intervalTemp);

        // Calculate median (more robust to outliers)
        const sorted = [...intervalTemp].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianTemp = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];

        tempMetrics = {
          min_ambient_temperature: Math.round(minTemp * 10) / 10,
          max_ambient_temperature: Math.round(maxTemp * 10) / 10,
          median_ambient_temperature: Math.round(medianTemp * 10) / 10,
          start_ambient_temperature: startTemp !== undefined ? Math.round(startTemp * 10) / 10 : 0,
          end_ambient_temperature: endTemp !== undefined ? Math.round(endTemp * 10) / 10 : 0,
        };
      }
    }

    return {
      type: raw.type,
      label: raw.label,
      group_id: raw.group_id,
      start_seconds: raw.start_time,
      duration: formatDuration(raw.moving_time),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, false) : undefined,

      // Power
      average_watts: raw.average_watts,
      max_watts: raw.max_watts,
      normalized_power: raw.weighted_average_watts,
      watts_per_kg: raw.average_watts_kg,
      power_zone: raw.zone,
      intensity_factor: raw.intensity ? raw.intensity / 100 : undefined,
      interval_tss: raw.training_load ? Math.round(raw.training_load * 10) / 10 : undefined,

      // Heart rate
      average_hr: raw.average_heartrate ? Math.round(raw.average_heartrate) : undefined,
      max_hr: raw.max_heartrate ? Math.round(raw.max_heartrate) : undefined,
      hr_decoupling: raw.decoupling,

      // Cadence/stride
      average_cadence: raw.average_cadence ? Math.round(raw.average_cadence) : undefined,
      stride_length_m: raw.average_stride,

      // Speed (m/s → km/h)
      average_speed: speedKph !== undefined ? formatSpeed(speedKph) : undefined,

      // Elevation
      elevation_gain: elevationGain !== undefined ? `${elevationGain} m` : undefined,
      average_gradient: raw.average_gradient !== undefined ? `${(raw.average_gradient * 100).toFixed(1)}%` : undefined,

      // W'bal
      wbal_start_j: raw.wbal_start,
      wbal_end_j: raw.wbal_end,
      joules_above_ftp: raw.joules_above_ftp,

      // Heat metrics (only if heat data available for this interval)
      ...heatMetrics,

      // Temperature metrics (only if temperature data available for this interval)
      ...tempMetrics,
    };
  }

  /**
   * Normalize an interval group from the API
   */
  private normalizeIntervalGroup(raw: IntervalsRawGroup): IntervalGroup {
    const speedKph = raw.average_speed ? raw.average_speed * 3.6 : undefined;
    const distanceKm = raw.distance ? raw.distance / 1000 : undefined;
    const elevationGain = raw.total_elevation_gain ? Math.round(raw.total_elevation_gain) : undefined;

    return {
      id: raw.id,
      count: raw.count,
      average_watts: raw.average_watts,
      average_hr: raw.average_heartrate ? Math.round(raw.average_heartrate) : undefined,
      average_cadence: raw.average_cadence ? Math.round(raw.average_cadence) : undefined,
      average_speed: speedKph !== undefined ? formatSpeed(speedKph) : undefined,
      distance: distanceKm !== undefined ? formatDistance(distanceKm, false) : undefined,
      duration: raw.moving_time !== undefined ? formatDuration(raw.moving_time) : undefined,
      elevation_gain: elevationGain !== undefined ? `${elevationGain} m` : undefined,
    };
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
      ctl_load: w.ctlLoad,
      atl_load: w.atlLoad,
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
      category: 'WORKOUT',
    });

    // Get timezone for date formatting
    const timezone = await this.getAthleteTimezone();

    return events.map((e) => this.normalizePlannedEvent(e, timezone));
  }

  /**
   * Get today's fitness metrics using the athlete's timezone.
   */
  async getTodayFitness(): Promise<FitnessMetrics | null> {
    const timezone = await this.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const metrics = await this.getFitnessMetrics(today, today);
    return metrics.length > 0 ? metrics[0] : null;
  }

  /**
   * Format sleep seconds to human-readable string like "8h 10m".
   */
  private formatSleepDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours === 0) {
      return `${minutes}m`;
    }
    if (minutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
  }

  /**
   * Convert raw wellness data from API to WellnessData type.
   * Only includes fields that have non-null values.
   */
  private mapWellnessData(data: IntervalsWellness): WellnessData {
    const result: WellnessData = {};

    // Weight
    if (data.weight != null) {
      result.weight = `${data.weight} kg`;
    }

    // Heart rate and HRV
    if (data.restingHR != null) {
      result.resting_hr = data.restingHR;
    }
    if (data.hrv != null) {
      result.hrv = data.hrv;
    }
    if (data.hrvSDNN != null) {
      result.hrv_sdnn = data.hrvSDNN;
    }

    // Menstrual cycle
    if (data.menstrualPhase != null) {
      result.menstrual_phase = data.menstrualPhase;
    }
    if (data.menstrualPhasePredicted != null) {
      result.menstrual_phase_predicted = data.menstrualPhasePredicted;
    }

    // Nutrition
    if (data.kcalConsumed != null) {
      result.kcal_consumed = data.kcalConsumed;
    }

    // Sleep
    if (data.sleepSecs != null) {
      result.sleep_duration = this.formatSleepDuration(data.sleepSecs);
    }
    if (data.sleepScore != null) {
      result.sleep_score = data.sleepScore;
    }
    if (data.sleepQuality != null) {
      result.sleep_quality = data.sleepQuality;
    }
    if (data.avgSleepingHR != null) {
      result.avg_sleeping_hr = data.avgSleepingHR;
    }

    // Subjective metrics (1-4 scale)
    if (data.soreness != null) {
      result.soreness = data.soreness;
    }
    if (data.fatigue != null) {
      result.fatigue = data.fatigue;
    }
    if (data.stress != null) {
      result.stress = data.stress;
    }
    if (data.mood != null) {
      result.mood = data.mood;
    }
    if (data.motivation != null) {
      result.motivation = data.motivation;
    }
    if (data.injury != null) {
      result.injury = data.injury;
    }
    if (data.hydration != null) {
      result.hydration = data.hydration;
    }

    // Vitals
    if (data.spO2 != null) {
      result.spo2 = data.spO2;
    }
    if (data.systolic != null && data.diastolic != null) {
      result.blood_pressure = {
        systolic: data.systolic,
        diastolic: data.diastolic,
      };
    }
    if (data.hydrationVolume != null) {
      result.hydration_volume = data.hydrationVolume;
    }
    if (data.respiration != null) {
      result.respiration = data.respiration;
    }

    // Readiness and body composition
    if (data.readiness != null) {
      result.readiness = data.readiness;
    }
    if (data.baevskySI != null) {
      result.baevsky_si = data.baevskySI;
    }
    if (data.bloodGlucose != null) {
      result.blood_glucose = data.bloodGlucose;
    }
    if (data.lactate != null) {
      result.lactate = data.lactate;
    }
    if (data.bodyFat != null) {
      result.body_fat = data.bodyFat;
    }
    if (data.abdomen != null) {
      result.abdomen = data.abdomen;
    }
    if (data.vo2max != null) {
      result.vo2max = data.vo2max;
    }

    // Activity and notes
    if (data.steps != null) {
      result.steps = data.steps;
    }
    if (data.comments != null) {
      result.comments = data.comments;
    }

    return result;
  }

  /**
   * Check if wellness data has any meaningful fields set.
   */
  private hasWellnessData(data: WellnessData): boolean {
    return Object.keys(data).length > 0;
  }

  /**
   * Get today's wellness data using the athlete's timezone.
   * Uses the single-date endpoint which returns actual values.
   */
  async getTodayWellness(): Promise<WellnessData | null> {
    const timezone = await this.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);

    try {
      // Use single-date endpoint - returns actual values, not null
      const data = await this.fetch<IntervalsWellness>(`/wellness/${today}`);
      const wellness = this.mapWellnessData(data);
      return this.hasWellnessData(wellness) ? wellness : null;
    } catch {
      // No wellness data for today
      return null;
    }
  }

  /**
   * Get wellness trends for a date range.
   * Includes entries that have any wellness data, not just weight.
   */
  async getWellnessTrends(startDate: string, endDate: string): Promise<WellnessTrends> {
    const wellness = await this.fetch<IntervalsWellness[]>('/wellness', {
      oldest: startDate,
      newest: endDate,
    });

    // Map all entries and filter to only those with wellness data
    const data: DailyWellness[] = wellness
      .map((w) => ({
        date: w.id,
        ...this.mapWellnessData(w),
      }))
      .filter((w) => Object.keys(w).length > 1); // More than just 'date'

    // Calculate period days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      period_days: periodDays,
      start_date: startDate,
      end_date: endDate,
      data,
    };
  }

  private async normalizeActivity(
    activity: IntervalsActivity,
    options?: { skipExpensiveCalls?: boolean }
  ): Promise<NormalizedWorkout> {
    // Check if this is a Strava-only workout that's not available via the API
    const isStravaOnly = activity.source === 'STRAVA' && activity._note !== undefined;

    if (isStravaOnly) {
      // Return minimal workout data for Strava-only activities
      // We only have basic metadata - no workout details are available
      const timezone = await this.getAthleteTimezone();
      return {
        id: activity.id,
        start_time: localStringToISO8601WithTimezone(activity.start_date_local, timezone),
        source: 'strava',
        unavailable: true,
        unavailable_reason: activity._note || 'This workout data is not available via the API',
      } as NormalizedWorkout;
    }

    // Fetch sport settings for zone normalization
    const sportSettings = await this.getSportSettings();
    const matchingSport = this.findMatchingSportSettings(activity.type, sportSettings);

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

    // Determine if this is a swimming activity for unit formatting
    const isSwim = isSwimmingActivity(activity.type);

    // Calculate duration in seconds
    const durationSeconds = activity.moving_time ?? activity.elapsed_time ?? 0;

    // Calculate distance in km
    const distanceKm = activity.distance ? activity.distance / 1000 : undefined;

    // Normalize threshold pace if available
    // Note: pace_units is not returned by the API for activities, so we use sport settings
    let thresholdPaceHuman: string | undefined;
    let thresholdPaceValue: number | undefined;
    let paceUnits: string | undefined;
    if (activity.threshold_pace) {
      // Use pace_units from sport settings (API doesn't return it for activities)
      paceUnits = matchingSport?.pace_units;
      if (paceUnits) {
        thresholdPaceValue = this.convertToPaceValue(activity.threshold_pace, paceUnits);
        thresholdPaceHuman = this.formatPaceValue(thresholdPaceValue, paceUnits);
      }
    }

    // Normalize power zone times to our format
    const powerZoneTimes = activity.icu_zone_times?.map((zt) => ({
      zone_id: zt.id,
      seconds: zt.secs,
    }));

    // Normalize zones using sport settings zone names and merge in time data
    const hrZones = this.normalizeActivityHRZones(
      activity.icu_hr_zones,
      matchingSport?.hr_zone_names,
      matchingSport?.max_hr,
      activity.icu_hr_zone_times
    );
    const powerZones = this.normalizeActivityPowerZones(
      activity.icu_power_zones,
      matchingSport?.power_zone_names,
      activity.icu_ftp,
      powerZoneTimes,
      matchingSport?.sweet_spot_min,
      matchingSport?.sweet_spot_max
    );
    const paceZones = this.normalizeActivityPaceZones(
      activity.pace_zones,
      matchingSport?.pace_zone_names,
      thresholdPaceValue,
      paceUnits,
      activity.pace_zone_times
    );

    // Fetch heat metrics from stream data only if heat_strain_index stream is available
    // Skip if skipExpensiveCalls is true (for bulk operations like activity totals)
    let heatMetrics = null;
    if (!options?.skipExpensiveCalls && activity.stream_types?.includes('heat_strain_index')) {
      heatMetrics = await this.getActivityHeatMetrics(activity.id);
    }

    // Fetch temperature metrics from stream data only if temp stream is available
    // Skip if skipExpensiveCalls is true (for bulk operations like activity totals)
    let tempMetrics = null;
    if (!options?.skipExpensiveCalls && activity.stream_types?.includes('temp')) {
      tempMetrics = await this.getActivityTemperatureMetrics(activity.id);
    }

    // Fetch notes for this activity
    // Skip if skipExpensiveCalls is true (for bulk operations like activity totals)
    let notes: WorkoutNote[] | undefined;
    if (!options?.skipExpensiveCalls) {
      try {
        const notesResponse = await this.getActivityNotes(activity.id);
        notes = notesResponse.notes.length > 0 ? notesResponse.notes : undefined;
      } catch (error) {
        // Notes may not be available for this activity
        notes = undefined;
      }
    }

    // Get athlete timezone for formatting start_time
    const timezone = await this.getAthleteTimezone();

    return {
      id: activity.id,
      start_time: localStringToISO8601WithTimezone(activity.start_date_local, timezone),
      activity_type: normalizeActivityType(activity.type),
      name: activity.name,
      description: activity.description,
      duration: formatDuration(durationSeconds),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, isSwim) : undefined,
      tss: activity.icu_training_load,
      // Handle both API field naming conventions (icu_ prefixed and non-prefixed)
      normalized_power: activity.icu_weighted_avg_watts ?? activity.weighted_avg_watts,
      average_power: activity.icu_average_watts ?? activity.average_watts,
      average_heart_rate: activity.average_heartrate,
      max_heart_rate: activity.max_heartrate,
      intensity_factor: activity.icu_intensity,
      elevation_gain: activity.total_elevation_gain !== undefined
        ? `${Math.round(activity.total_elevation_gain)} m`
        : undefined,
      calories: activity.calories,
      source: 'intervals.icu',

      // Activity URLs
      intervals_icu_url: `https://intervals.icu/activities/${activity.id}`,
      garmin_connect_url:
        activity.source === 'GARMIN_CONNECT' && activity.external_id
          ? `https://connect.garmin.com/modern/activity/${activity.external_id}`
          : undefined,
      zwift_url:
        activity.source === 'ZWIFT' && activity.external_id
          ? `https://www.zwift.com/activity/${activity.external_id}`
          : undefined,
      strava_url: activity.strava_id
        ? `https://www.strava.com/activities/${activity.strava_id}`
        : undefined,

      // Speed metrics
      average_speed: avgSpeedKph !== undefined ? formatSpeed(avgSpeedKph) : undefined,
      max_speed: maxSpeedKph !== undefined ? formatSpeed(maxSpeedKph) : undefined,

      // Coasting
      coasting_time: activity.coasting_time !== undefined
        ? formatDuration(activity.coasting_time)
        : undefined,
      coasting_percentage: coastingPercentage,

      // Training load & feel
      load: activity.icu_training_load,
      rpe: this.pickHighestRpe(activity.rpe, activity.icu_rpe),
      feel: activity.feel,

      // HR metrics
      hrrc: activity.hrrc,
      trimp: activity.trimp,

      // Power efficiency (handle both API field naming conventions)
      variability_index: activity.icu_variability_index ?? activity.variability_index,
      power_hr_ratio: activity.decoupling,
      efficiency_factor: activity.icu_efficiency_factor ?? activity.efficiency_factor,

      // Fitness snapshot (handle both API field naming conventions)
      ctl_at_activity: activity.icu_ctl ?? activity.ctl,
      atl_at_activity: activity.icu_atl ?? activity.atl,
      tsb_at_activity: (() => {
        const ctl = activity.icu_ctl ?? activity.ctl;
        const atl = activity.icu_atl ?? activity.atl;
        return ctl !== undefined && atl !== undefined ? ctl - atl : undefined;
      })(),

      // Cadence
      average_cadence: activity.average_cadence,
      max_cadence: activity.max_cadence,

      // Thresholds
      ftp: activity.icu_ftp,
      eftp: activity.icu_eftp,
      activity_eftp: activity.icu_pm_ftp,
      lthr: activity.lthr,

      // Energy (handle both API field naming conventions)
      work_kj: (() => {
        const joules = activity.icu_joules ?? activity.joules;
        return joules ? joules / 1000 : undefined;
      })(),
      cho_used_g: activity.carbs_used,
      cho_intake_g: activity.carbs_ingested,

      // Athlete metrics at time of activity
      weight: activity.icu_weight != null ? `${activity.icu_weight} kg` : undefined,
      resting_hr: activity.icu_resting_hr,

      // Activity context flags
      // is_indoor: true if trainer flag is set, OR activity type contains "virtual", OR source is Zwift
      is_indoor: activity.trainer === true ||
        activity.type.toLowerCase().includes('virtual') ||
        activity.source?.toLowerCase() === 'zwift',
      is_commute: activity.commute,
      is_race: activity.race,

      // Threshold pace
      threshold_pace: thresholdPaceHuman,

      // Zone thresholds (normalized with names and time in zone)
      hr_zones: hrZones,
      power_zones: powerZones,
      pace_zones: paceZones,
      heat_zones: heatMetrics?.zones,

      // Heat metrics
      max_heat_strain_index: heatMetrics?.max_heat_strain_index,
      median_heat_strain_index: heatMetrics?.median_heat_strain_index,

      // Temperature metrics
      min_ambient_temperature: tempMetrics?.min_ambient_temperature,
      max_ambient_temperature: tempMetrics?.max_ambient_temperature,
      median_ambient_temperature: tempMetrics?.median_ambient_temperature,
      start_ambient_temperature: tempMetrics?.start_ambient_temperature,
      end_ambient_temperature: tempMetrics?.end_ambient_temperature,

      // Running/pace metrics
      average_stride_m: activity.average_stride,
      gap: gapSecPerKm !== undefined ? formatPace(gapSecPerKm, isSwim) : undefined,

      // Altitude
      average_altitude_m: activity.average_altitude,
      min_altitude_m: activity.min_altitude,
      max_altitude_m: activity.max_altitude,

      // Session metrics
      session_rpe: activity.session_rpe,
      icu_strain_score: activity.strain_score,

      // Notes
      notes,
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

  /**
   * Convert activity type to sport (ActivityType)
   * Uses normalizeActivityType for consistent mapping across platforms
   */
  private activityTypeToSport(type: string | undefined): ActivityType | undefined {
    if (!type) return undefined;
    const normalized = normalizeActivityType(type);
    // Return the normalized type (could be Cycling, Running, Swimming, Skiing, etc.)
    // Only return undefined if we truly can't determine the type
    return normalized === 'Other' ? undefined : normalized;
  }

  private normalizePlannedEvent(event: IntervalsEvent, timezone: string): PlannedWorkout {
    // Calculate duration in seconds
    const durationSeconds = event.moving_time ?? (event.duration ? event.duration * 60 : undefined);

    return {
      id: event.uid ?? String(event.id),
      scheduled_for: localStringToISO8601WithTimezone(event.start_date_local, timezone),
      name: event.name,
      description: event.description,
      expected_tss: event.icu_training_load,
      expected_if: event.icu_intensity,
      expected_duration: durationSeconds !== undefined
        ? formatDuration(durationSeconds)
        : undefined,
      sport: this.activityTypeToSport(event.type),
      source: 'intervals.icu',
      tags: event.tags,
      external_id: event.external_id,
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
      ctl_load: w.ctlLoad,
      atl_load: w.atlLoad,
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

  // ============================================
  // Performance Curves
  // ============================================

  /**
   * Format duration in seconds to human-readable label.
   * e.g., 5 -> "5s", 60 -> "1min", 3600 -> "1hr"
   */
  private formatDurationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins}min`;
    }
    const hours = Math.floor(seconds / 3600);
    return `${hours}hr`;
  }

  /**
   * Format distance in meters to human-readable label.
   * e.g., 400 -> "400m", 1000 -> "1km", 1609 -> "1mi"
   */
  private formatDistanceLabel(meters: number): string {
    if (meters === 1609 || meters === 1610) return '1mi';
    if (meters >= 1000) {
      const km = meters / 1000;
      if (Number.isInteger(km)) return `${km}km`;
      return `${km.toFixed(1)}km`;
    }
    return `${meters}m`;
  }

  /**
   * Format time in seconds to pace string.
   * For running: min:ss/km
   * For swimming: min:ss/100m
   */
  private formatPaceFromTime(
    timeSeconds: number,
    distanceMeters: number,
    isSwimming: boolean
  ): string {
    if (isSwimming) {
      // Seconds per 100m
      const per100m = (timeSeconds / distanceMeters) * 100;
      const mins = Math.floor(per100m / 60);
      const secs = Math.round(per100m % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}/100m`;
    } else {
      // Minutes per km
      const perKm = (timeSeconds / distanceMeters) * 1000;
      const mins = Math.floor(perKm / 60);
      const secs = Math.round(perKm % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}/km`;
    }
  }

  /**
   * Get power curves for activities in a date range.
   * Returns best power at each duration for each activity.
   */
  async getPowerCurves(
    startDate: string,
    endDate: string,
    type?: string,
    secs?: number[]
  ): Promise<{
    durations: number[];
    activities: ActivityPowerCurve[];
  }> {
    const params: Record<string, string> = {
      oldest: startDate,
      newest: endDate,
    };

    if (type) {
      params.type = type;
    }

    if (secs && secs.length > 0) {
      params.secs = secs.join(',');
    }

    const response = await this.fetch<RawPowerCurvesResponse>(
      '/activity-power-curves',
      params
    );

    const durations = response.secs;
    const activities: ActivityPowerCurve[] = response.curves.map((curve) => ({
      activity_id: curve.id,
      date: curve.start_date_local,
      weight_kg: curve.weight,
      curve: curve.watts.map((watts, index) => ({
        duration_seconds: durations[index],
        duration_label: this.formatDurationLabel(durations[index]),
        watts,
        watts_per_kg:
          curve.weight > 0 ? Math.round((watts / curve.weight) * 100) / 100 : 0,
      })),
    }));

    return { durations, activities };
  }

  /**
   * Get pace curves for activities in a date range.
   * Returns best time at each distance for each activity.
   */
  async getPaceCurves(
    startDate: string,
    endDate: string,
    type: string,
    distances: number[],
    gap?: boolean
  ): Promise<{
    distances: number[];
    gap_adjusted: boolean;
    activities: ActivityPaceCurve[];
  }> {
    const params: Record<string, string> = {
      oldest: startDate,
      newest: endDate,
      type,
      distances: distances.join(','),
    };

    if (gap !== undefined) {
      params.gap = String(gap);
    }

    const response = await this.fetch<RawPaceCurvesResponse>(
      '/activity-pace-curves',
      params
    );

    const responseDistances = response.distances;
    const isSwimming = type === 'Swim' || type === 'OpenWaterSwim';

    const activities: ActivityPaceCurve[] = response.curves.map((curve) => ({
      activity_id: curve.id,
      date: curve.start_date_local,
      weight_kg: curve.weight,
      // Filter to only include distances where we have time data
      curve: curve.secs.map((timeSeconds, index) => ({
        distance_meters: responseDistances[index],
        distance_label: this.formatDistanceLabel(responseDistances[index]),
        time_seconds: timeSeconds,
        pace: this.formatPaceFromTime(
          timeSeconds,
          responseDistances[index],
          isSwimming
        ),
      })),
    }));

    return {
      distances: responseDistances,
      gap_adjusted: response.gap,
      activities,
    };
  }

  /**
   * Get HR curves for activities in a date range.
   * Returns max sustained HR at each duration for each activity.
   */
  async getHRCurves(
    startDate: string,
    endDate: string,
    type?: string,
    secs?: number[]
  ): Promise<{
    durations: number[];
    activities: ActivityHRCurve[];
  }> {
    const params: Record<string, string> = {
      oldest: startDate,
      newest: endDate,
    };

    if (type) {
      params.type = type;
    }

    if (secs && secs.length > 0) {
      params.secs = secs.join(',');
    }

    const response = await this.fetch<RawHRCurvesResponse>(
      '/activity-hr-curves',
      params
    );

    const durations = response.secs;
    const activities: ActivityHRCurve[] = response.curves.map((curve) => ({
      activity_id: curve.id,
      date: curve.start_date_local,
      curve: curve.bpm.map((bpm, index) => ({
        duration_seconds: durations[index],
        duration_label: this.formatDurationLabel(durations[index]),
        bpm,
      })),
    }));

    return { durations, activities };
  }

  // ============================================
  // Event CRUD Operations
  // ============================================

  /**
   * POST JSON to an athlete endpoint.
   */
  private async postJson<T>(
    endpoint: string,
    body: unknown,
    context?: { operation: string; resource?: string }
  ): Promise<T> {
    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);

    const errorContext = context ?? {
      operation: `post ${endpoint}`,
      resource: undefined,
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, errorContext);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * PUT JSON to an athlete endpoint.
   */
  private async putJson<T>(
    endpoint: string,
    body: unknown,
    context?: { operation: string; resource?: string }
  ): Promise<T> {
    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);

    const errorContext = context ?? {
      operation: `put ${endpoint}`,
      resource: undefined,
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, errorContext);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * DELETE an athlete endpoint.
   */
  private async deleteHttp(
    endpoint: string,
    context?: { operation: string; resource?: string }
  ): Promise<void> {
    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);

    const errorContext = context ?? {
      operation: `delete ${endpoint}`,
      resource: undefined,
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, errorContext);
      }
    } catch (error) {
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * PUT JSON to an activity endpoint.
   * Uses /activity/{id} instead of /athlete/{id}
   */
  private async putActivity<T>(
    activityId: string,
    endpoint: string,
    body: unknown,
    queryParams?: Record<string, string | boolean>,
    context?: { operation: string; resource?: string }
  ): Promise<T> {
    const url = new URL(`${INTERVALS_API_BASE}/activity/${activityId}${endpoint}`);

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
    }

    const errorContext = context ?? {
      operation: `put activity ${endpoint}`,
      resource: `activity ${activityId}`,
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw IntervalsApiError.fromHttpStatus(response.status, errorContext);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof IntervalsApiError) {
        throw error;
      }
      throw IntervalsApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Create a new event/workout on the athlete's calendar.
   * POST /api/v1/athlete/{id}/events
   */
  async createEvent(input: CreateEventInput): Promise<CreateEventResponse> {
    const response = await this.postJson<CreateEventResponse>(
      '/events',
      input,
      { operation: 'create event', resource: input.name }
    );
    return response;
  }

  /**
   * Update an existing event/workout on the athlete's calendar.
   * PUT /api/v1/athlete/{id}/events/{eventId}
   *
   * Only provided fields will be updated.
   */
  async updateEvent(
    eventId: string | number,
    input: UpdateEventInput
  ): Promise<UpdateEventResponse> {
    const response = await this.putJson<UpdateEventResponse>(
      `/events/${eventId}`,
      input,
      { operation: 'update event', resource: `event ${eventId}` }
    );
    return response;
  }

  /**
   * Delete an event/workout from the athlete's calendar.
   * DELETE /api/v1/athlete/{id}/events/{eventId}
   */
  async deleteEvent(eventId: string | number): Promise<void> {
    await this.deleteHttp(
      `/events/${eventId}`,
      { operation: 'delete event', resource: `event ${eventId}` }
    );
  }

  /**
   * Get a single event by ID.
   * GET /api/v1/athlete/{id}/events/{eventId}
   */
  async getEvent(eventId: string | number): Promise<IntervalsEvent> {
    return await this.fetch<IntervalsEvent>(
      `/events/${eventId}`,
      undefined,
      { operation: 'get event', resource: `event ${eventId}` }
    );
  }

  /**
   * Get all events with a specific tag within a date range.
   * Used for finding Domestique-created workouts.
   */
  async getEventsByTag(
    tag: string,
    startDate: string,
    endDate: string
  ): Promise<IntervalsEvent[]> {
    const events = await this.fetch<IntervalsEvent[]>('/events', {
      oldest: startDate,
      newest: endDate,
    });
    return events.filter((e) => e.tags?.includes(tag));
  }

  /**
   * Update intervals on a completed activity.
   * PUT /api/v1/activity/{id}/intervals?all={replaceAll}
   *
   * When replaceAll is true, all existing intervals on the activity are replaced.
   * When replaceAll is false, the new intervals are merged with existing ones.
   * Intervals.icu will recalculate all metrics (power, HR, cadence, etc.)
   * from the recorded activity data based on the provided time ranges.
   */
  async updateActivityIntervals(
    activityId: string,
    intervals: ActivityIntervalInput[],
    replaceAll: boolean = true
  ): Promise<void> {
    // Map our input format to the API format
    // The API uses start_index/end_index (data point indices) rather than start_time/end_time
    // For 1Hz data (most common), these are equal to seconds
    const apiIntervals = intervals.map((interval) => ({
      start_index: interval.start_time,
      end_index: interval.end_time,
      type: interval.type,
      label: interval.label,
    }));

    await this.putActivity<unknown>(
      activityId,
      '/intervals',
      apiIntervals,
      { all: replaceAll },
      { operation: 'update activity intervals', resource: `activity ${activityId}` }
    );
  }
}
