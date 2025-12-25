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
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import {
  formatDuration,
  formatDistance,
  formatSpeed,
  formatPace,
  isSwimmingActivity,
} from '../utils/format-units.js';

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
   * Get the complete athlete profile including sport settings.
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    const [profile, sportSettings] = await Promise.all([
      this.fetch<IntervalsAthleteProfile>('/profile'),
      this.getSportSettings(),
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
      result.pace_units = settings.pace_units;
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
   * Fetch from activity-specific endpoints (uses /activity/{id} instead of /athlete/{id})
   */
  private async fetchActivity<T>(activityId: string, endpoint: string): Promise<T> {
    const url = new URL(`${INTERVALS_API_BASE}/activity/${activityId}${endpoint}`);

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

    return Promise.all(filtered.map((a) => this.normalizeActivity(a)));
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

    const intervals = (response.icu_intervals || []).map((i) =>
      this.normalizeInterval(i)
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

    // Filter out deleted messages and normalize
    const notes: WorkoutNote[] = (messages || [])
      .filter((m) => m.deleted === null)
      .map((m) => ({
        id: m.id,
        athlete_id: m.athlete_id,
        name: m.name,
        created: m.created,
        type: m.type,
        content: m.content,
        attachment_url: m.attachment_url ?? undefined,
        attachment_mime_type: m.attachment_mime_type ?? undefined,
      }));

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
   * Normalize a raw interval from the API
   */
  private normalizeInterval(raw: IntervalsRawInterval): WorkoutInterval {
    const distanceKm = raw.distance ? raw.distance / 1000 : undefined;
    const speedKph = raw.average_speed ? raw.average_speed * 3.6 : undefined;
    const elevationGain = raw.total_elevation_gain ? Math.round(raw.total_elevation_gain) : undefined;

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
      average_gradient_pct: raw.average_gradient ? raw.average_gradient * 100 : undefined,

      // W'bal
      wbal_start_j: raw.wbal_start,
      wbal_end_j: raw.wbal_end,
      joules_above_ftp: raw.joules_above_ftp,
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

  private async normalizeActivity(activity: IntervalsActivity): Promise<NormalizedWorkout> {
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

    return {
      id: activity.id,
      date: activity.start_date_local,
      start_date_utc: activity.start_date, // UTC for cross-platform matching
      activity_type: normalizeActivityType(activity.type),
      name: activity.name,
      description: activity.description,
      duration: formatDuration(durationSeconds),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, isSwim) : undefined,
      tss: activity.icu_training_load,
      normalized_power: activity.weighted_avg_watts,
      average_power: activity.average_watts,
      average_heart_rate: activity.average_heartrate,
      max_heart_rate: activity.max_heartrate,
      intensity_factor: activity.icu_intensity,
      elevation_gain: activity.total_elevation_gain !== undefined
        ? `${Math.round(activity.total_elevation_gain)} m`
        : undefined,
      calories: activity.calories,
      source: 'intervals.icu',

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

      // Threshold pace
      threshold_pace: thresholdPaceHuman,
      pace_units: paceUnits,

      // Zone thresholds (normalized with names and time in zone)
      hr_zones: hrZones,
      power_zones: powerZones,
      pace_zones: paceZones,

      // Advanced power metrics
      joules_above_ftp: activity.icu_joules_above_ftp,
      max_wbal_depletion: activity.icu_max_wbal_depletion,
      polarization_index: activity.polarization_index,

      // Running/pace metrics
      average_stride_m: activity.average_stride,
      gap: gapSecPerKm !== undefined ? formatPace(gapSecPerKm, isSwim) : undefined,

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
    // Calculate duration in seconds
    const durationSeconds = event.moving_time ?? (event.duration ? event.duration * 60 : undefined);

    return {
      id: event.uid ?? String(event.id),
      date: event.start_date_local,
      name: event.name,
      description: event.description,
      expected_tss: event.icu_training_load,
      expected_if: event.icu_intensity,
      expected_duration: durationSeconds !== undefined
        ? formatDuration(durationSeconds)
        : undefined,
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
}
