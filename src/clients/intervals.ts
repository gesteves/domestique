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
  UnitSystem,
  WeightUnit,
  TemperatureUnit,
  WindUnit,
  PrecipitationUnit,
  HeightUnit,
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
  PlayedSong,
  WeatherLocation,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import {
  formatDuration,
  formatDistance,
  formatDurationLabel,
  formatSpeed,
  formatPace,
  isSwimmingActivity,
  formatPower,
  formatHR,
  formatPercent,
  formatTemperature,
  formatWeight,
  formatStride,
  formatLength,
  formatEnergy,
  formatEnergyKJ,
  formatCadence,
  formatMass,
  formatHRV,
  formatVO2max,
  formatBP,
  withUnit,
  formatPoolLength,
  formatStrokeLength,
  formatRpe,
  formatFeel,
  formatSoreness,
  formatFatigue,
  formatMood,
  formatMotivation,
  formatInjury,
} from '../utils/format-units.js';
import { getTodayInTimezone } from '../utils/tz.js';
import { localStringToISO8601WithTimezone } from '../utils/date-formatting.js';
import {
  calculateHeatMetrics,
  parseHeatStrainStreams,
} from '../utils/heat-zones.js';
import {
  calculateTemperatureMetrics,
  parseTemperatureStreams,
} from '../utils/temperature-metrics.js';
import { IntervalsApiError, type ErrorContext } from '../errors/index.js';
import { httpRequestJson, httpRequestVoid } from './http.js';
import { memoize } from '../utils/memo.js';

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

const WIND_UNIT_MAP: Record<'KMH' | 'MPS' | 'KNOTS' | 'MPH' | 'BFT', WindUnit> = {
  KMH: 'kmh',
  MPS: 'mps',
  KNOTS: 'knots',
  MPH: 'mph',
  BFT: 'bft',
};

const intervalsHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    IntervalsApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    IntervalsApiError.networkError(context, err),
};

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
  wind_speed?: 'KMH' | 'MPS' | 'KNOTS' | 'MPH' | 'BFT'; // wind speed unit override
  rain?: 'MM' | 'INCHES'; // precipitation unit override
  height_units?: 'CM' | 'FEET'; // athlete physical-stature height unit override
  // Date of birth (only available at root endpoint, not /profile)
  icu_date_of_birth?: string; // ISO date (YYYY-MM-DD)
  // Per-provider wellness key configuration: which wellness fields each
  // connected platform is configured to feed into Intervals.icu. Each entry is
  // an API field name (e.g., "restingHR", "hrv", "sleepSecs"). Used to attach
  // a `sources` map to wellness records.
  icu_garmin_wellness_keys?: string[];
  whoop_wellness_keys?: string[];
  oura_wellness_keys?: string[];
}

// Profile endpoint returns nested structure (used for timezone caching)
interface IntervalsAthleteProfile {
  athlete: {
    id: string;
    timezone?: string;
  };
}

// Weather forecast configuration from /athlete/{id}/weather-config endpoint
interface IntervalsWeatherForecastLocation {
  enabled: boolean;
  id: number;
  label: string;
  lat: number;
  lon: number;
  /** Free-form location string from Intervals.icu, e.g. "San Francisco,California,US" */
  location: string;
  provider?: string;
}

interface IntervalsWeatherConfig {
  forecasts?: IntervalsWeatherForecastLocation[];
}

// Sport settings from /sport-settings endpoint
interface IntervalsSportSettings {
  id: number;
  athlete_id: string;
  types: string[];
  ftp?: number;
  indoor_ftp?: number;
  sweet_spot_min?: number | null;
  sweet_spot_max?: number | null;
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
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  elapsed_time?: number;
  icu_recording_time?: number; // Total recording time in seconds
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

  // Sweet spot boundaries (from single activity endpoint)
  icu_sweet_spot_min?: number;
  icu_sweet_spot_max?: number;

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
  icu_pm_ftp?: number; // activity-derived eFTP from power model
  lthr?: number; // Lactate threshold HR at time of activity
  athlete_max_hr?: number; // Max HR setting at time of activity

  // Power model estimates (from single activity endpoint)
  icu_pm_cp?: number; // Critical Power from power model
  icu_pm_w_prime?: number; // W' from power model
  icu_pm_p_max?: number; // Pmax from power model
  icu_pm_ftp_secs?: number; // Duration for modeled FTP
  icu_pm_ftp_watts?: number; // Modeled FTP watts

  // Rolling fitness estimates (from single activity endpoint)
  icu_rolling_cp?: number | null;
  icu_rolling_w_prime?: number;
  icu_rolling_p_max?: number;
  icu_rolling_ftp?: number;
  icu_rolling_ftp_delta?: number;

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

  // Interval summary (from single activity endpoint)
  interval_summary?: string[]; // e.g., ["2x 5m 133w", "3x 10m 202w"]

  // Load breakdown by metric (from single activity endpoint)
  power_load?: number;
  hr_load?: number;
  pace_load?: number | null;
  hr_load_type?: string; // e.g., "HRSS"
  pace_load_type?: string | null;

  // Z2 metrics (from single activity endpoint)
  icu_power_hr_z2?: number; // Power/HR ratio in Z2
  icu_power_hr_z2_mins?: number; // Minutes in Z2 for this calculation
  icu_cadence_z2?: number; // Average cadence in Z2

  // Compliance (from single activity endpoint)
  compliance?: number; // Workout compliance percentage (0-100)

  // Swim-specific (from single activity endpoint)
  pool_length?: number; // Pool length in meters (e.g., 22.86 for a 25yd pool)
  lengths?: number; // Number of pool lengths swum
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
  carbohydrates?: number; // grams
  protein?: number; // grams
  fatTotal?: number; // grams

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

  // Custom metrics
  HeatAdaptationScore?: number;
}

/**
 * Maps Intervals.icu wellness API field names (as they appear in
 * `IntervalsWellness` and in the `*_wellness_keys` configuration arrays on
 * the athlete root endpoint) to the snake_case output keys we emit in
 * `WellnessFields`. Used to label each wellness field with its configured
 * provider (garmin/whoop/oura) via `attachWellnessSources`.
 *
 * Identity entries are kept for clarity and to make the surface explicit when
 * adding new fields. Keys that already match (e.g., `weight`, `soreness`) need
 * no entry — the helper falls back to the API key as-is for those.
 */
const WELLNESS_API_TO_OUTPUT_KEY: Record<string, string> = {
  restingHR: 'resting_hr',
  hrvSDNN: 'hrv_sdnn',
  menstrualPhase: 'menstrual_phase',
  menstrualPhasePredicted: 'menstrual_phase_predicted',
  kcalConsumed: 'kcal_consumed',
  carbohydrates: 'carbs',
  fatTotal: 'fat_total',
  sleepSecs: 'sleep_duration',
  sleepScore: 'sleep_score',
  sleepQuality: 'sleep_quality',
  avgSleepingHR: 'avg_sleeping_hr',
  spO2: 'spo2',
  hydrationVolume: 'hydration_volume',
  baevskySI: 'baevsky_si',
  bloodGlucose: 'blood_glucose',
  bodyFat: 'body_fat',
  // Diastolic isn't an emitted output field on its own — both sides combine
  // into `blood_pressure`. Map both API keys to the same output for sourcing.
  systolic: 'blood_pressure',
  diastolic: 'blood_pressure',
  HeatAdaptationScore: 'heat_adaptation_score',
};

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
  // Intervals.icu parses structured workout syntax out of `description` into
  // this field. `workout_doc.description` is the prose-only prefix.
  workout_doc?: {
    description?: string;
  };
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
  private playedSongsGetter:
    | ((startMs: number, endMs: number) => Promise<PlayedSong[]>)
    | null = null;

  // Session-lifetime memoized fetchers. Each gives single-flight + cache-on-success
  // for endpoints that return effectively-constant profile/settings data.
  private fetchTimezone = memoize(async () => {
    const profile = await this.fetch<IntervalsAthleteProfile>('/profile');
    return profile.athlete.timezone ?? 'UTC';
  });
  private fetchSportSettingsCached = memoize(() =>
    this.fetch<IntervalsSportSettings[]>('/sport-settings')
  );
  private fetchUnitPreferencesCached = memoize(async () => {
    const athlete = await this.fetch<IntervalsAthleteData>('');
    return this.computeUnitPreferences(
      athlete.measurement_preference,
      athlete.weight_pref_lb,
      athlete.fahrenheit,
      athlete.wind_speed,
      athlete.rain,
      athlete.height_units
    );
  });
  // Build a map from output wellness field name (e.g., "hrv", "sleep_duration")
  // to its configured provider ("garmin" | "whoop" | "oura"). Inferred from
  // the athlete's `*_wellness_keys` arrays on the root endpoint. Resolution
  // order on overlap (rare in practice — Intervals.icu's UI assigns each field
  // to one provider): whoop > garmin > oura, achieved by writing whoop last so
  // it wins.
  private fetchWellnessSourcesCached = memoize(async () => {
    const athlete = await this.fetch<IntervalsAthleteData>('');
    const sources: Record<string, 'garmin' | 'whoop' | 'oura'> = {};
    const assign = (apiKeys: string[] | undefined, source: 'garmin' | 'whoop' | 'oura') => {
      if (!apiKeys) return;
      for (const apiKey of apiKeys) {
        const outputKey = WELLNESS_API_TO_OUTPUT_KEY[apiKey] ?? apiKey;
        sources[outputKey] = source;
      }
    };
    assign(athlete.oura_wellness_keys, 'oura');
    assign(athlete.icu_garmin_wellness_keys, 'garmin');
    assign(athlete.whoop_wellness_keys, 'whoop');
    return sources;
  });
  private fetchWeatherConfigCached = memoize(async () => {
    const response = await this.fetch<IntervalsWeatherConfig>('/weather-config');
    return response.forecasts ?? [];
  });

  constructor(config: IntervalsConfig) {
    this.config = config;
    // Intervals.icu uses API key as password with "API_KEY" as username
    const credentials = Buffer.from(`API_KEY:${config.apiKey}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  /**
   * Set a function that fetches played songs for a time range (ms since epoch).
   * When set, normalizeActivity attaches the songs under `played_songs` for single-activity
   * fetches (skipExpensiveCalls: false).
   */
  setPlayedSongsGetter(
    getter: (startMs: number, endMs: number) => Promise<PlayedSong[]>
  ): void {
    this.playedSongsGetter = getter;
  }

  /**
   * Get the athlete's timezone from their profile.
   * Cached after first successful fetch; defaults to UTC on error (and retries
   * on the next call rather than caching the fallback).
   */
  async getAthleteTimezone(): Promise<string> {
    try {
      return await this.fetchTimezone();
    } catch (error) {
      console.error('Error fetching athlete timezone, defaulting to UTC:', error);
      return 'UTC';
    }
  }

  /**
   * Get sport settings. Cached and single-flighted via memoize so concurrent
   * normalizeActivity calls share one HTTP request.
   */
  private getSportSettings(): Promise<IntervalsSportSettings[]> {
    return this.fetchSportSettingsCached();
  }

  /**
   * Compute unit preferences from raw API values.
   * @param measurementPreference - "meters" (metric) or "feet" (imperial); fallback for distance/speed/pace/elevation/stride
   * @param weightPrefLb - true = use pounds for weight regardless of measurement_preference
   * @param fahrenheit - true = use Fahrenheit regardless of measurement_preference
   * @param windSpeed - wind speed unit override; missing → follow system
   * @param rain - precipitation unit override; missing → follow system
   * @param heightUnits - athlete physical-stature height unit override; missing → follow system
   */
  private computeUnitPreferences(
    measurementPreference: 'meters' | 'feet' | undefined,
    weightPrefLb: boolean | undefined,
    fahrenheit: boolean | undefined,
    windSpeed?: 'KMH' | 'MPS' | 'KNOTS' | 'MPH' | 'BFT',
    rain?: 'MM' | 'INCHES',
    heightUnits?: 'CM' | 'FEET'
  ): UnitPreferences {
    const isMetric = measurementPreference !== 'feet';
    const system: UnitSystem = isMetric ? 'metric' : 'imperial';

    const weight: WeightUnit = weightPrefLb ? 'lb' : (isMetric ? 'kg' : 'lb');
    const temperature: TemperatureUnit = fahrenheit ? 'fahrenheit' : (isMetric ? 'celsius' : 'fahrenheit');

    const wind: WindUnit = windSpeed
      ? WIND_UNIT_MAP[windSpeed]
      : (isMetric ? 'kmh' : 'mph');
    const precipitation: PrecipitationUnit = rain
      ? (rain === 'INCHES' ? 'inches' : 'mm')
      : (isMetric ? 'mm' : 'inches');
    const height: HeightUnit = heightUnits
      ? (heightUnits === 'FEET' ? 'feet' : 'cm')
      : (isMetric ? 'cm' : 'feet');

    return { system, weight, temperature, wind, precipitation, height };
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
   * Cached and single-flighted via memoize. Uses root athlete endpoint which
   * has the unit preference fields (the /profile endpoint does not).
   */
  getUnitPreferences(): Promise<UnitPreferences> {
    return this.fetchUnitPreferencesCached();
  }

  /**
   * Get the complete athlete profile.
   * Note: Sport-specific settings are now retrieved via getSportSettingsForSport().
   * Uses root athlete endpoint which has unit preferences and DOB.
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    // Use root endpoint (empty string) which has all fields including DOB and unit prefs
    const athlete = await this.fetch<IntervalsAthleteData>('');

    const unitPreferences = this.computeUnitPreferences(
      athlete.measurement_preference,
      athlete.weight_pref_lb,
      athlete.fahrenheit,
      athlete.wind_speed,
      athlete.rain,
      athlete.height_units
    );

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
   * Get the athlete's enabled weather-forecast locations from Intervals.icu.
   * Memoized — locations rarely change. Returns only the locations the user has
   * marked enabled in their Intervals.icu weather settings.
   */
  async getEnabledWeatherLocations(): Promise<WeatherLocation[]> {
    const locations = await this.fetchWeatherConfigCached();
    return locations
      .filter((l) => l.enabled)
      .map((l) => ({
        id: l.id,
        label: l.label,
        latitude: l.lat,
        longitude: l.lon,
        location: l.location,
      }));
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
      result.ftp = formatPower(settings.ftp);
      // Only include indoor_ftp if different
      if (settings.indoor_ftp && settings.indoor_ftp !== settings.ftp) {
        result.indoor_ftp = formatPower(settings.indoor_ftp);
      }
    }

    // Sweet spot (% of FTP)
    if (settings.sweet_spot_min != null) {
      result.sweet_spot_min = formatPercent(settings.sweet_spot_min);
    }
    if (settings.sweet_spot_max != null) {
      result.sweet_spot_max = formatPercent(settings.sweet_spot_max);
    }

    // Heart rate thresholds
    if (settings.lthr) result.lthr = formatHR(settings.lthr);
    if (settings.max_hr) result.max_hr = formatHR(settings.max_hr);

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
        low_hr: formatHR(low),
        high_hr: high !== null ? formatHR(high) : null,
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
        low_pct: formatPercent(lowPercent),
        high_pct: highPercent !== null ? formatPercent(highPercent) : null,
        low_power: formatPower((lowPercent / 100) * ftp),
        high_power: highPercent ? formatPower((highPercent / 100) * ftp) : null,
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
        low_pct: formatPercent(lowPercent),
        high_pct: highPercent !== null ? formatPercent(highPercent) : null,
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
    sweetSpotMin: number | null | undefined,
    sweetSpotMax: number | null | undefined
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
      if (sweetSpotSeconds && sweetSpotSeconds > 0 && sweetSpotMin != null && sweetSpotMax != null) {
        zones.push({
          name: 'Sweet Spot',
          low_pct: formatPercent(sweetSpotMin),
          high_pct: formatPercent(sweetSpotMax),
          low_power: formatPower((sweetSpotMin / 100) * ftp),
          high_power: formatPower((sweetSpotMax / 100) * ftp),
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

    const errorContext: ErrorContext = {
      ...(context ?? { operation: `fetch ${endpoint}` }),
      ...(params ? { parameters: params } : {}),
    };

    return httpRequestJson<T>({
      url: url.toString(),
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
      context: errorContext,
      ...intervalsHttpErrorBuilders,
    });
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

    return httpRequestJson<T>({
      url: url.toString(),
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
      context: {
        operation: context?.operation ?? `fetch activity ${endpoint}`,
        resource: `activity ${activityId}`,
      },
      ...intervalsHttpErrorBuilders,
    });
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
        (a) => a.type && normalizeActivityType(a.type) === normalizedSport
      );
    }

    // Concurrent normalizeActivity calls share a single in-flight sport-settings
    // request via single-flight inside getSportSettings(); no pre-warm needed.
    return Promise.all(filtered.map((a) => this.normalizeActivity(a, options)));
  }

  /**
   * Get a single activity by ID with full details.
   * This fetches all available data including heat metrics, temperature, and notes.
   * Uses the /activity/{id} endpoint which returns more detailed data than the list endpoint.
   */
  async getActivity(activityId: string): Promise<NormalizedWorkout> {
    // Use fetchActivity which calls /activity/{id} endpoint (not /athlete/{id}/activities)
    const fetched = await this.fetchActivity<IntervalsActivity>(activityId, '');
    // The single-activity endpoint may not include the ID in the response — patch it
    // into a new object rather than mutating the API response.
    const activity = fetched.id ? fetched : { ...fetched, id: activityId };
    // Always fetch full details for single activity requests (skipExpensiveCalls: false)
    return await this.normalizeActivity(activity, { skipExpensiveCalls: false });
  }

  /**
   * Get intervals for a specific activity.
   *
   * Pass `activityType` so cadence values use the correct unit (rpm for cycling,
   * spm for running/swimming) and `poolLengthM` so swim interval distances pick
   * the right unit (yards for SCY/LCY pools, meters otherwise). When either is
   * omitted, the activity is fetched once to look them up.
   */
  async getActivityIntervals(
    activityId: string,
    activityType?: string,
    poolLengthM?: number
  ): Promise<WorkoutIntervalsResponse> {
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

    // Only fetch the activity when the caller didn't tell us the type.
    // If the caller passed `activityType` but no `poolLengthM`, we trust them —
    // most non-swim activities have no pool length.
    let resolvedActivityType = activityType ?? '';
    let resolvedPoolLength = poolLengthM;
    if (!resolvedActivityType) {
      try {
        const activity = await this.fetchActivity<IntervalsActivity>(activityId, '');
        resolvedActivityType = activity.type ?? '';
        if (resolvedPoolLength === undefined) resolvedPoolLength = activity.pool_length ?? undefined;
      } catch (error) {
        // If we can't resolve the activity, cadence defaults to rpm and swim
        // distances default to meters.
      }
    }

    const intervals = (response.icu_intervals || []).map((i) =>
      this.normalizeInterval(i, resolvedActivityType, resolvedPoolLength, heatStreamData, tempStreamData)
    );
    const groups = (response.icu_groups || []).map((g) =>
      this.normalizeIntervalGroup(g, resolvedActivityType, resolvedPoolLength)
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
    activityType: string,
    poolLengthM: number | undefined,
    heatStreamData: { time: number[]; heat_strain_index: number[] } | null = null,
    tempStreamData: { time: number[]; temp: number[] } | null = null
  ): WorkoutInterval {
    const distanceKm = raw.distance ? raw.distance / 1000 : undefined;
    const speedKph = raw.average_speed ? raw.average_speed * 3.6 : undefined;
    const elevationGain = raw.total_elevation_gain ? Math.round(raw.total_elevation_gain) : undefined;
    const isSwim = isSwimmingActivity(activityType);

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
          min_ambient_temperature: string;
          max_ambient_temperature: string;
          median_ambient_temperature: string;
          start_ambient_temperature: string;
          end_ambient_temperature: string;
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
          min_ambient_temperature: formatTemperature(minTemp),
          max_ambient_temperature: formatTemperature(maxTemp),
          median_ambient_temperature: formatTemperature(medianTemp),
          start_ambient_temperature: formatTemperature(startTemp ?? 0),
          end_ambient_temperature: formatTemperature(endTemp ?? 0),
        };
      }
    }

    return {
      type: raw.type,
      label: raw.label,
      group_id: raw.group_id,
      start_seconds: raw.start_time,
      duration: formatDuration(raw.moving_time),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, isSwim, poolLengthM) : undefined,

      // Power
      average_power: raw.average_watts != null ? formatPower(raw.average_watts) : undefined,
      max_power: raw.max_watts != null ? formatPower(raw.max_watts) : undefined,
      normalized_power:
        raw.weighted_average_watts != null ? formatPower(raw.weighted_average_watts) : undefined,
      power_to_weight:
        raw.average_watts_kg != null ? withUnit(raw.average_watts_kg, 'W/kg', 1) : undefined,
      power_zone: raw.zone,
      intensity_factor: raw.intensity ? raw.intensity / 100 : undefined,
      interval_tss: raw.training_load ? Math.round(raw.training_load * 10) / 10 : undefined,

      // Heart rate
      average_hr: raw.average_heartrate ? formatHR(raw.average_heartrate) : undefined,
      max_hr: raw.max_heartrate ? formatHR(raw.max_heartrate) : undefined,
      hr_decoupling: raw.decoupling != null ? formatPercent(raw.decoupling, 1) : undefined,

      // Cadence/stride
      average_cadence:
        raw.average_cadence != null ? formatCadence(raw.average_cadence, activityType) : undefined,
      stride_length:
        raw.average_stride != null
          ? (isSwim ? formatStrokeLength(raw.average_stride, poolLengthM) : formatStride(raw.average_stride))
          : undefined,

      // Speed (m/s → km/h)
      average_speed: speedKph != null ? formatSpeed(speedKph) : undefined,

      // Elevation
      elevation_gain: elevationGain != null ? formatLength(elevationGain) : undefined,
      average_gradient: raw.average_gradient != null ? `${(raw.average_gradient * 100).toFixed(1)}%` : undefined,

      // W'bal
      wbal_start: raw.wbal_start != null ? formatEnergy(raw.wbal_start) : undefined,
      wbal_end: raw.wbal_end != null ? formatEnergy(raw.wbal_end) : undefined,
      energy_above_ftp:
        raw.joules_above_ftp != null ? formatEnergy(raw.joules_above_ftp) : undefined,

      // Heat metrics (only if heat data available for this interval)
      ...heatMetrics,

      // Temperature metrics (only if temperature data available for this interval)
      ...tempMetrics,
    };
  }

  /**
   * Normalize an interval group from the API
   */
  private normalizeIntervalGroup(
    raw: IntervalsRawGroup,
    activityType: string,
    poolLengthM: number | undefined
  ): IntervalGroup {
    const speedKph = raw.average_speed ? raw.average_speed * 3.6 : undefined;
    const distanceKm = raw.distance ? raw.distance / 1000 : undefined;
    const elevationGain = raw.total_elevation_gain ? Math.round(raw.total_elevation_gain) : undefined;
    const isSwim = isSwimmingActivity(activityType);

    return {
      id: raw.id,
      count: raw.count,
      average_power: raw.average_watts != null ? formatPower(raw.average_watts) : undefined,
      average_hr: raw.average_heartrate ? formatHR(raw.average_heartrate) : undefined,
      average_cadence:
        raw.average_cadence != null ? formatCadence(raw.average_cadence, activityType) : undefined,
      average_speed: speedKph != null ? formatSpeed(speedKph) : undefined,
      distance: distanceKm != null ? formatDistance(distanceKm, isSwim, poolLengthM) : undefined,
      duration: raw.moving_time != null ? formatDuration(raw.moving_time) : undefined,
      elevation_gain: elevationGain != null ? formatLength(elevationGain) : undefined,
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
      result.weight = formatWeight(data.weight);
    }

    // Heart rate and HRV
    if (data.restingHR != null) {
      result.resting_hr = formatHR(data.restingHR);
    }
    if (data.hrv != null) {
      result.hrv = formatHRV(data.hrv);
    }
    if (data.hrvSDNN != null) {
      result.hrv_sdnn = formatHRV(data.hrvSDNN);
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
    if (data.carbohydrates != null) {
      result.carbs = withUnit(data.carbohydrates, 'g');
    }
    if (data.protein != null) {
      result.protein = withUnit(data.protein, 'g');
    }
    if (data.fatTotal != null) {
      result.fat_total = withUnit(data.fatTotal, 'g');
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
      result.avg_sleeping_hr = formatHR(data.avgSleepingHR);
    }

    // Subjective metrics (1-4 scale)
    if (data.soreness != null) {
      const formatted = formatSoreness(data.soreness);
      if (formatted) result.soreness = formatted;
    }
    if (data.fatigue != null) {
      const formatted = formatFatigue(data.fatigue);
      if (formatted) result.fatigue = formatted;
    }
    if (data.stress != null) {
      result.stress = data.stress;
    }
    if (data.mood != null) {
      const formatted = formatMood(data.mood);
      if (formatted) result.mood = formatted;
    }
    if (data.motivation != null) {
      const formatted = formatMotivation(data.motivation);
      if (formatted) result.motivation = formatted;
    }
    if (data.injury != null) {
      const formatted = formatInjury(data.injury);
      if (formatted) result.injury = formatted;
    }
    if (data.hydration != null) {
      result.hydration = data.hydration;
    }

    // Vitals
    if (data.spO2 != null) {
      result.spo2 = formatPercent(data.spO2, 1);
    }
    if (data.systolic != null && data.diastolic != null) {
      result.blood_pressure = formatBP(data.systolic, data.diastolic);
    }
    if (data.hydrationVolume != null) {
      result.hydration_volume = withUnit(data.hydrationVolume, 'ml');
    }
    if (data.respiration != null) {
      result.respiration = withUnit(data.respiration, 'breaths/min', 1);
    }

    // Readiness and body composition
    if (data.readiness != null) {
      result.readiness = data.readiness;
    }
    if (data.baevskySI != null) {
      result.baevsky_si = data.baevskySI;
    }
    if (data.bloodGlucose != null) {
      result.blood_glucose = withUnit(data.bloodGlucose, 'mg/dL');
    }
    if (data.lactate != null) {
      result.lactate = withUnit(data.lactate, 'mmol/L', 1);
    }
    if (data.bodyFat != null) {
      result.body_fat = formatPercent(data.bodyFat, 1);
    }
    if (data.abdomen != null) {
      result.abdomen = withUnit(data.abdomen, 'cm', 1);
    }
    if (data.vo2max != null) {
      result.vo2max = formatVO2max(data.vo2max);
    }

    // Activity and notes
    if (data.steps != null) {
      result.steps = data.steps;
    }
    if (data.comments != null) {
      result.comments = data.comments;
    }

    // Custom metrics
    if (data.HeatAdaptationScore != null) {
      result.heat_adaptation_score = formatPercent(data.HeatAdaptationScore);
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
   * Attach a `sources` map to a wellness object, labeling each present output
   * field with its configured provider (garmin/whoop/oura). Mutates and
   * returns the input. Skips fields with no configured source (likely manual
   * entry); skips the entire `sources` field when no providers contribute.
   * The `date` key on `DailyWellness` is excluded since it's not a metric.
   */
  private async attachWellnessSources<T extends WellnessData>(wellness: T): Promise<T> {
    let sourceMap: Record<string, 'garmin' | 'whoop' | 'oura'>;
    try {
      sourceMap = await this.fetchWellnessSourcesCached();
    } catch (error) {
      // Source attribution is best-effort: never let a profile-fetch failure
      // sink the whole wellness call. Surface the wellness data without sources.
      console.error('Error fetching wellness source configuration:', error);
      return wellness;
    }
    const sources: Record<string, string> = {};
    for (const key of Object.keys(wellness)) {
      if (key === 'date' || key === 'sources') continue;
      const source = sourceMap[key];
      if (source) sources[key] = source;
    }
    if (wellness.heat_adaptation_score != null && !sources.heat_adaptation_score) {
      sources.heat_adaptation_score = 'core body temperature sensor';
    }
    if (Object.keys(sources).length > 0) {
      wellness.sources = sources;
    }
    return wellness;
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
      if (!this.hasWellnessData(wellness)) return null;
      return await this.attachWellnessSources(wellness);
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
    const mapped: DailyWellness[] = wellness
      .map((w) => ({
        date: w.id,
        ...this.mapWellnessData(w),
      }))
      .filter((w) => Object.keys(w).length > 1); // More than just 'date'

    // Attach per-day source map. The provider-keys config is constant for the
    // range (one HTTP call, memoized), but the *present-fields* subset varies
    // per day, so build the per-day map individually.
    const data = await Promise.all(mapped.map((entry) => this.attachWellnessSources(entry)));

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

    // Pool length (in meters) drives the unit choice for swim distances:
    // SCY/LCY pools (≈22.86m or ≈45.72m) emit yards, SCM/LCM and unknown emit meters.
    const poolLengthM = activity.pool_length ?? undefined;

    // Determine if this is a swimming activity for unit formatting
    const isSwim = activity.type ? isSwimmingActivity(activity.type) : false;

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

    // Fetch detailed interval data for this activity
    // Skip if skipExpensiveCalls is true (for bulk operations like activity totals)
    let intervals: WorkoutInterval[] | undefined;
    let intervalGroups: IntervalGroup[] | undefined;
    if (!options?.skipExpensiveCalls) {
      try {
        const intervalsResponse = await this.getActivityIntervals(activity.id, activity.type, poolLengthM);
        intervals = intervalsResponse.intervals.length > 0 ? intervalsResponse.intervals : undefined;
        intervalGroups = intervalsResponse.groups.length > 0 ? intervalsResponse.groups : undefined;
      } catch (error) {
        // Intervals may not be available for this activity
        intervals = undefined;
        intervalGroups = undefined;
      }
    }

    // Fetch weather for outdoor activities only
    // Skip if skipExpensiveCalls is true (for bulk operations like activity totals)
    const isIndoor = activity.trainer === true ||
      activity.type?.toLowerCase().includes('virtual') ||
      activity.source?.toLowerCase() === 'zwift';
    let weatherDescription: string | null | undefined;
    if (!options?.skipExpensiveCalls && !isIndoor) {
      const weatherResponse = await this.getActivityWeather(activity.id);
      weatherDescription = weatherResponse.weather_description;
    }

    // Fetch songs played during the activity from Last.fm (if configured)
    // Skip if skipExpensiveCalls is true
    let playedSongs: PlayedSong[] | undefined;
    if (!options?.skipExpensiveCalls && this.playedSongsGetter) {
      try {
        const { startMs, endMs } = computeActivityTimeRange(activity);
        const songs = await this.playedSongsGetter(startMs, endMs);
        playedSongs = songs.length > 0 ? songs : undefined;
      } catch (error) {
        // Last.fm failures should never fail activity normalization
        playedSongs = undefined;
      }
    }

    // Get athlete timezone for formatting start_time
    const timezone = await this.getAthleteTimezone();

    const activityType = activity.type ?? '';
    const normalizedPowerVal = activity.icu_weighted_avg_watts ?? activity.weighted_avg_watts;
    const averagePowerVal = activity.icu_average_watts ?? activity.average_watts;
    const variabilityIndex = activity.icu_variability_index ?? activity.variability_index;
    const efficiencyFactor = activity.icu_efficiency_factor ?? activity.efficiency_factor;
    const ctlAtActivity = activity.icu_ctl ?? activity.ctl;
    const atlAtActivity = activity.icu_atl ?? activity.atl;
    const joulesTotal = activity.icu_joules ?? activity.joules;

    // Carbohydrate intake rate (g/h). Gated on both intake and usage being
    // logged and positive: a partial CHO record (one missing) tends to mean
    // the athlete didn't track fueling for this activity, so the rate would
    // mislead. Always grams per hour, regardless of unit preferences.
    const carbsUsed = activity.carbs_used;
    const carbsIngested = activity.carbs_ingested;
    const carbsPerHour =
      carbsUsed != null && carbsUsed > 0 &&
      carbsIngested != null && carbsIngested > 0 &&
      activity.moving_time != null && activity.moving_time > 0
        ? `${Math.round((carbsIngested / activity.moving_time) * 3600)} g/h`
        : undefined;

    return {
      id: activity.id,
      start_time: localStringToISO8601WithTimezone(activity.start_date_local, timezone),
      activity_type: activity.type ? normalizeActivityType(activity.type) : 'Other',
      name: activity.name,
      description: activity.description,
      duration: formatDuration(durationSeconds),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, isSwim, poolLengthM) : undefined,
      tss: activity.icu_training_load,
      // Handle both API field naming conventions (icu_ prefixed and non-prefixed)
      normalized_power: normalizedPowerVal != null ? formatPower(normalizedPowerVal) : undefined,
      average_power: averagePowerVal != null ? formatPower(averagePowerVal) : undefined,
      average_heart_rate: activity.average_heartrate != null ? formatHR(activity.average_heartrate) : undefined,
      max_heart_rate: activity.max_heartrate != null ? formatHR(activity.max_heartrate) : undefined,
      intensity_factor: activity.icu_intensity,
      elevation_gain: activity.total_elevation_gain != null
        ? formatLength(activity.total_elevation_gain)
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
      average_speed: avgSpeedKph != null ? formatSpeed(avgSpeedKph) : undefined,
      max_speed: maxSpeedKph != null ? formatSpeed(maxSpeedKph) : undefined,

      // Coasting
      coasting_time: activity.coasting_time != null
        ? formatDuration(activity.coasting_time)
        : undefined,
      coasting_percentage: coastingPercentage != null ? formatPercent(coastingPercentage, 1) : undefined,

      // Training load & feel
      load: activity.icu_training_load,
      rpe: (() => {
        const v = this.pickHighestRpe(activity.rpe, activity.icu_rpe);
        return v != null ? formatRpe(v) : undefined;
      })(),
      feel: activity.feel != null ? formatFeel(activity.feel) : undefined,

      // HR metrics
      hrrc: activity.hrrc,
      trimp: activity.trimp,

      // Power efficiency (handle both API field naming conventions)
      variability_index: variabilityIndex,
      power_hr_ratio: activity.decoupling,
      efficiency_factor: efficiencyFactor,

      // Fitness snapshot (handle both API field naming conventions)
      ctl_at_activity: ctlAtActivity,
      atl_at_activity: atlAtActivity,
      tsb_at_activity:
        ctlAtActivity !== undefined && atlAtActivity !== undefined ? ctlAtActivity - atlAtActivity : undefined,

      // Cadence
      average_cadence:
        activity.average_cadence != null ? formatCadence(activity.average_cadence, activityType) : undefined,
      max_cadence:
        activity.max_cadence != null ? formatCadence(activity.max_cadence, activityType) : undefined,

      // Thresholds
      ftp: activity.icu_ftp != null ? formatPower(activity.icu_ftp) : undefined,
      eftp: activity.icu_eftp != null ? formatPower(activity.icu_eftp) : undefined,
      activity_eftp: activity.icu_pm_ftp != null ? formatPower(activity.icu_pm_ftp) : undefined,
      lthr: activity.lthr != null ? formatHR(activity.lthr) : undefined,

      // Energy (handle both API field naming conventions)
      work: joulesTotal != null ? formatEnergyKJ(joulesTotal / 1000) : undefined,
      carbs_used: activity.carbs_used != null ? formatMass(activity.carbs_used) : undefined,
      carbs_intake: activity.carbs_ingested != null ? formatMass(activity.carbs_ingested) : undefined,
      carbs_per_hour: carbsPerHour,

      // Athlete metrics at time of activity
      weight: activity.icu_weight != null ? formatWeight(activity.icu_weight) : undefined,
      resting_hr: activity.icu_resting_hr != null ? formatHR(activity.icu_resting_hr) : undefined,

      // Activity context flags
      // is_indoor: true if trainer flag is set, OR activity type contains "virtual", OR source is Zwift
      is_indoor: isIndoor,
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
      min_ambient_temperature:
        tempMetrics?.min_ambient_temperature != null ? formatTemperature(tempMetrics.min_ambient_temperature) : undefined,
      max_ambient_temperature:
        tempMetrics?.max_ambient_temperature != null ? formatTemperature(tempMetrics.max_ambient_temperature) : undefined,
      median_ambient_temperature:
        tempMetrics?.median_ambient_temperature != null ? formatTemperature(tempMetrics.median_ambient_temperature) : undefined,
      start_ambient_temperature:
        tempMetrics?.start_ambient_temperature != null ? formatTemperature(tempMetrics.start_ambient_temperature) : undefined,
      end_ambient_temperature:
        tempMetrics?.end_ambient_temperature != null ? formatTemperature(tempMetrics.end_ambient_temperature) : undefined,

      // Running/pace metrics
      // For swims the value is per-stroke distance; the unit follows the pool.
      average_stride: activity.average_stride != null
        ? (isSwim ? formatStrokeLength(activity.average_stride, poolLengthM) : formatStride(activity.average_stride))
        : undefined,
      gap: gapSecPerKm != null ? formatPace(gapSecPerKm, isSwim) : undefined,

      // Swimming metrics (only present for pool swims)
      pool_length: poolLengthM != null ? formatPoolLength(poolLengthM) : undefined,
      lengths: activity.lengths,

      // Altitude
      average_altitude: activity.average_altitude != null ? formatLength(activity.average_altitude) : undefined,
      min_altitude: activity.min_altitude != null ? formatLength(activity.min_altitude) : undefined,
      max_altitude: activity.max_altitude != null ? formatLength(activity.max_altitude) : undefined,

      // Session metrics
      session_rpe: activity.session_rpe,
      icu_strain_score: activity.strain_score,

      // Notes
      notes,

      // Detailed interval data
      intervals,
      interval_groups: intervalGroups,

      // Rolling fitness estimates
      rolling_ftp: activity.icu_rolling_ftp != null ? formatPower(activity.icu_rolling_ftp) : undefined,
      rolling_ftp_delta:
        activity.icu_rolling_ftp_delta != null ? formatPower(activity.icu_rolling_ftp_delta) : undefined,

      // Interval summary
      interval_summary: activity.interval_summary,

      // Load breakdown by metric type
      power_load: activity.power_load,
      hr_load: activity.hr_load,
      pace_load: activity.pace_load ?? undefined,

      // Z2 aerobic metrics
      power_hr_z2: activity.icu_power_hr_z2,
      power_hr_z2_mins:
        activity.icu_power_hr_z2_mins != null ? withUnit(activity.icu_power_hr_z2_mins, 'min', 1) : undefined,
      cadence_z2:
        activity.icu_cadence_z2 != null ? formatCadence(activity.icu_cadence_z2, activityType) : undefined,

      // Workout compliance
      compliance: activity.compliance != null ? formatPercent(activity.compliance) : undefined,

      // Weather (only fetched for outdoor activities in single-activity requests)
      weather_description: weatherDescription,

      // Songs played during the activity (only fetched when Last.fm is configured)
      played_songs: playedSongs,
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
   * @param startDate - Start date (YYYY-MM-DD) of the analysis range
   * @param endDate - End date (YYYY-MM-DD) of the analysis range
   */
  async getTrainingLoadTrends(startDate: string, endDate: string): Promise<TrainingLoadTrends> {
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

    // Inclusive day count between the two dates
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
    const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
    const periodDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;

    return {
      period_days: periodDays,
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
   * Format time-over-distance to a pace string in the athlete's preferred units.
   * Delegates to the shared `formatPace` so the per-km/per-mi and /100m/100yd
   * decisions are made in one place.
   */
  private formatPaceFromTime(
    timeSeconds: number,
    distanceMeters: number,
    isSwimming: boolean
  ): string {
    const secPerKm = (timeSeconds / distanceMeters) * 1000;
    return formatPace(secPerKm, isSwimming);
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
        duration_label: formatDurationLabel(durations[index]),
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
        duration_label: formatDurationLabel(durations[index]),
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
    return httpRequestJson<T>({
      url: url.toString(),
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      context: context ?? { operation: `post ${endpoint}` },
      ...intervalsHttpErrorBuilders,
    });
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
    return httpRequestJson<T>({
      url: url.toString(),
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      context: context ?? { operation: `put ${endpoint}` },
      ...intervalsHttpErrorBuilders,
    });
  }

  /**
   * DELETE an athlete endpoint.
   */
  private async deleteHttp(
    endpoint: string,
    context?: { operation: string; resource?: string }
  ): Promise<void> {
    const url = new URL(`${INTERVALS_API_BASE}/athlete/${this.config.athleteId}${endpoint}`);
    return httpRequestVoid({
      url: url.toString(),
      method: 'DELETE',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
      context: context ?? { operation: `delete ${endpoint}` },
      ...intervalsHttpErrorBuilders,
    });
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

    return httpRequestJson<T>({
      url: url.toString(),
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      context: context ?? {
        operation: `put activity ${endpoint}`,
        resource: `activity ${activityId}`,
      },
      ...intervalsHttpErrorBuilders,
    });
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
   * Update a completed activity's metadata (name, description).
   * PUT /api/v1/activity/{id}
   */
  async updateActivity(
    activityId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.putActivity<unknown>(
      activityId,
      '',
      updates,
      undefined,
      { operation: 'update activity', resource: `activity ${activityId}` }
    );
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

/**
 * Compute start/end time for an activity as milliseconds since epoch.
 * Uses start_date (UTC) and moving_time (falling back to elapsed_time).
 */
function computeActivityTimeRange(activity: IntervalsActivity): {
  startMs: number;
  endMs: number;
} {
  const startMs = new Date(activity.start_date).getTime();
  const durationSeconds = activity.moving_time ?? activity.elapsed_time ?? 0;
  const endMs = startMs + durationSeconds * 1000;
  return { startMs, endMs };
}
