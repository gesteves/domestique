/**
 * Field descriptions for MCP tool responses.
 * These are included in responses so the LLM knows what each field means and its units.
 */

export const WORKOUT_FIELD_DESCRIPTIONS = {
  // Core fields
  id: 'Unique ID of the completed activity in Intervals.icu',
  date: 'Activity start time in local timezone (ISO 8601)',
  start_date_utc: 'Activity start time in UTC (ISO 8601 with Z suffix)',
  activity_type: 'Normalized type: Cycling, Running, Swimming, Skiing, Hiking, Rowing, Strength, or Other',
  name: 'Activity name or title',
  description: 'Activity description or notes',
  duration: 'Total duration of the activity',
  distance: 'Total distance of the activity',
  source: 'Data source: intervals.icu, whoop, or trainerroad',

  // Training load
  tss: 'Training Stress Score (TSS)',
  load: 'Training load (same as TSS for power-based activities)',
  intensity_factor: 'Intensity Factor (IF)',
  trimp: 'Training Impulse',
  session_rpe: 'Session RPE = RPE × duration in minutes',
  strain_score: 'Intervals.icu strain score (unrelated to Whoop\'s strain)',

  // Power metrics
  normalized_power: 'Normalized Power (NP) in watts',
  average_power: 'Average power in watts',
  ftp: 'Functional Threshold Power used for this activity, in watts',
  eftp: 'Estimated FTP from Intervals.icu, in watts',
  activity_eftp: 'eFTP derived from this specific activity, in watts',
  w_prime: "W' (W prime), anaerobic work capacity in joules",
  pmax: 'Maximum power capacity in watts',
  work_kj: 'Total work done, in kilojoules',
  joules_above_ftp: 'Work done above FTP, in joules',
  max_wbal_depletion: "Maximum W'bal depletion during activity, in joules",

  // Heart rate
  average_heart_rate: 'Average heart rate in beats per minute',
  max_heart_rate: 'Maximum heart rate in beats per minute',
  hrrc: 'Heart rate recovery, drop in HR in first minute after stopping',

  // Speed
  average_speed: 'Average speed during the activity',
  max_speed: 'Maximum speed during the activity',

  // Cadence
  average_cadence: 'Average cadence in RPM (cycling) or steps/min (running)',
  max_cadence: 'Maximum cadence in RPM or steps/min',

  // Efficiency
  variability_index: 'Variability Index (VI)',
  power_hr_ratio: 'Power:HR decoupling, positive means cardiac drift occurred',
  efficiency_factor: 'Efficiency Factor (EF)',

  // Coasting
  coasting_time: 'Total time spent coasting',
  coasting_percentage: 'Percentage of ride time spent coasting',

  // Subjective
  rpe: 'Rate of Perceived Exertion (1-10 scale)',
  feel: 'How the athlete felt (1-5 scale, 1 = strong, 2 = good, 3 = normal, 4 = poor, 5 = weak)',

  // Fitness snapshot
  ctl_at_activity: 'Chronic Training Load (CTL/fitness) at time of activity',
  atl_at_activity: 'Acute Training Load (ATL/fatigue) at time of activity',
  tsb_at_activity: 'Training Stress Balance (TSB/form) at time of activity',

  // Elevation
  elevation_gain: 'Elevation gain during the activity',
  average_altitude_m: 'Average altitude in meters',
  min_altitude_m: 'Minimum altitude in meters',
  max_altitude_m: 'Maximum altitude in meters',

  // Temperature
  average_temp_c: 'Average temperature in Celsius',
  min_temp_c: 'Minimum temperature in Celsius',
  max_temp_c: 'Maximum temperature in Celsius',

  // Energy
  calories: 'Estimated calories burned',
  cho_used_g: 'Estimated carbohydrates used, in grams',
  cho_intake_g: 'Carbohydrates consumed during activity, in grams. Seldom used, its absence doesn’t imply lack of consumption.',

  // Running specific
  average_stride_m: 'Average stride length in meters',
  gap: 'Gradient Adjusted Pace',

  // Activity context
  is_indoor: 'Whether activity was on a trainer/treadmill/indoor',
  is_commute: 'Whether activity was marked as a commute',
  is_race: 'Whether activity was marked as a race',
  workout_class: 'Workout classification: Endurance, Tempo, Threshold, VO2max, etc.',

  // Zone data (normalized with names, thresholds, and time in zones)
  hr_zones: 'Array of heart rate zone objects. Each object contains: name (e.g., "Z1", "Z2"), low_bpm, high_bpm (null for highest zone), and time_in_zone (human-readable duration like "1:49:44"). These zones are from the time of the activity and may differ from current athlete profile zones.',
  power_zones: 'Array of power zone objects. Each object contains: name (e.g., "Active Recovery", "Endurance"), low_percent, high_percent (null for highest zone), low_watts, high_watts (null for highest zone), and time_in_zone (human-readable duration). Zones are from the time of the activity and may differ from current athlete profile zones.',
  pace_zones: 'Array of pace zone objects. Each object contains: name (e.g., "Easy", "Tempo"), low_percent, high_percent (null for highest zone), slow_pace (slower pace at low %), fast_pace (faster pace at high %), and time_in_zone (human-readable duration). Zones are from the time of the activity and may differ from current athlete profile zones.',

  // Polarization
  polarization_index: 'Training polarization index (0-2). Higher = more polarized (Z1 + Z5+ with little Z3-Z4)',

  // Device
  device_name: 'Recording device name (e.g., Garmin Edge, ZWIFT)',
  power_meter: 'Power meter used',

  // Counts
  intervals_count: 'Number of structured intervals in workout',
  laps_count: 'Number of laps/segments',
};

export const WHOOP_FIELD_DESCRIPTIONS = {
  // Strain activity
  strain_score: 'Whoop strain score (0-21 scale, logarithmic). Light: 0-9, Moderate: 10-13, High: 14-17, All out: 18-21',
  average_heart_rate: 'Average heart rate in BPM',
  max_heart_rate: 'Maximum heart rate in BPM',
  calories: 'Estimated calories burned',
  duration: 'Human-readable duration (e.g., "1:30:00")',
  distance: 'Human-readable distance (e.g., "45.2 km" or "2500 m" for swimming)',
  elevation_gain: 'Human-readable elevation gain (e.g., "500 m")',
  zone_durations: 'Time spent in each Whoop HR zone. Note: Whoop uses the Heart Rate Reserve (HRR) method to calculate; they may not match Intervals.icu HR zones.',
  strain_level: 'Strain level',
  strain_level_description: 'Whoop\'s official description for this strain level',
};

export const RECOVERY_FIELD_DESCRIPTIONS = {
  date: 'Date of recovery data (ISO 8601)',
  recovery_score: 'Whoop recovery score (0-100%). Sufficient: ≥67%, Adequate: 34-66%, Low: <34%',
  resting_heart_rate: 'Resting heart rate in BPM',
  hrv_rmssd: 'Heart Rate Variability in milliseconds (RMSSD). Higher generally indicates better recovery',
  spo2_percentage: 'Blood oxygen saturation percentage',
  skin_temp_celsius: 'Skin temperature in Celsius',

  // Sleep metrics
  sleep_performance_percentage: 'Sleep performance vs. sleep need (0-100%). Optimal: ≥85%, Sufficient: 70-85%, Poor: <70%',
  sleep_consistency_percentage: 'Sleep consistency score (0-100%)',
  sleep_efficiency_percentage: 'Sleep efficiency - time asleep / time in bed (0-100%)',
  respiratory_rate: 'Breaths per minute during sleep',

  // Sleep durations (human-readable, e.g., "7:12:40")
  sleep_duration: 'Total sleep duration',
  sleep_quality_duration: 'Time spent in Restorative sleep. Restorative sleep is the sum of time spent in Deep or REM sleep.',
  sleep_needed: 'Sleep needed for full recovery',
  light_sleep: 'Time spent in Light sleep',
  slow_wave_sleep: 'Time spent in deep/slow wave sleep.',
  rem_sleep: 'Time spent in REM sleep',
  awake_time: 'Time awake during sleep period',
  in_bed_time: 'Total time in bed',
  sleep_cycle_count: 'Number of complete sleep cycles',
  disturbance_count: 'Number of sleep disturbances',
  recovery_level: 'Recovery level',
  recovery_level_description: 'Whoop\'s official description for this recovery level',
  sleep_performance_level: 'Sleep performance level',
  sleep_performance_level_description: 'Whoop\'s official description for this sleep performance level',
};

export const FITNESS_FIELD_DESCRIPTIONS = {
  // Data array (sorted oldest to newest)
  data: 'Array of daily training load metrics, sorted oldest to newest (first item = oldest day)',
  date: 'Date of fitness metrics (ISO 8601 YYYY-MM-DD)',
  ctl: 'Chronic Training Load (fitness) - 42-day exponentially weighted average of daily TSS',
  atl: 'Acute Training Load (fatigue) - 7-day exponentially weighted average of daily TSS',
  tsb: 'Training Stress Balance (form) = CTL - ATL. Positive = fresh, negative = fatigued. -10 to +25 typical for optimal performance',
  ramp_rate: 'Rate of CTL change per week. Safe: 3-7 pts/week. Aggressive: 7+ pts/week. Injury risk increases above 10 pts/week',
  ctl_load: 'Weighted contribution to CTL from this day\'s training. Shows how much this day\'s training impacted the 42-day fitness average.',
  atl_load: 'Weighted contribution to ATL from this day\'s training. Shows how much this day\'s training impacted the 7-day fatigue average.',

  // Summary fields
  current_ctl: 'Most recent CTL value (current fitness level)',
  current_atl: 'Most recent ATL value (current fatigue level)',
  current_tsb: 'Most recent TSB value (current form)',
  ctl_trend: 'CTL trend direction: increasing, stable, or decreasing',
  avg_ramp_rate: 'Average weekly CTL change rate over the period',
  peak_ctl: 'Highest CTL reached during the period',
  peak_ctl_date: 'Date when peak CTL was reached',
  acwr: 'Acute:Chronic Workload Ratio = ATL/CTL. Optimal: 0.8-1.3. Caution: 1.3-1.5. High injury risk: >1.5',
  acwr_status: 'ACWR risk assessment: optimal, low_risk, caution, or high_risk',
};

export const PLANNED_WORKOUT_FIELD_DESCRIPTIONS = {
  id: 'Unique workout identifier',
  date: 'Scheduled date/time (ISO 8601)',
  name: 'Workout name',
  description: 'Workout description, possibly including structure',
  expected_tss: 'Expected Training Stress Score',
  expected_if: 'Expected Intensity Factor (as percentage)',
  expected_duration: 'Expected duration of the workout',
  workout_type: 'Type of workout (Ride, Run, Swim, etc.)',
  source: 'Calendar source: intervals.icu or trainerroad',
};

export const ATHLETE_PROFILE_FIELD_DESCRIPTIONS = {
  // Athlete info
  id: 'Unique ID of the athlete in Intervals.icu',
  name: 'Athlete\'s name',
  city: 'City of residence',
  state: 'State/province of residence',
  country: 'Country of residence',
  timezone: 'Athlete\'s timezone',
  sex: 'Athlete\'s gender',
  date_of_birth: 'Date of birth in ISO format (YYYY-MM-DD). Only present if set in Intervals.icu.',
  age: 'Current age in years. Only present if date_of_birth is set.',

  // Unit preferences - CRITICAL for LLM responses
  unit_preferences: 'User\'s preferred unit system. You MUST use these units in all responses to the user.',
  system: 'Base unit system: "metric" or "imperial". Use metric units (km, m, kg, celsius) for metric, imperial units (mi, ft, lb, fahrenheit) for imperial.',
  weight: 'Weight unit: "kg" or "lb". May differ from system preference - always use this for weight.',
  temperature: 'Temperature unit: "celsius" or "fahrenheit". May differ from system preference - always use this for temperatures.',
};

export const SPORT_SETTINGS_FIELD_DESCRIPTIONS = {
  // Sport settings response structure
  sport: 'The sport queried (cycling, running, or swimming)',
  types: 'Activity types this sport setting applies to (e.g., ["Ride", "VirtualRide", "GravelRide"])',
  settings: 'The sport-specific settings object containing thresholds and zones',

  // Unit preferences - included in response for LLM guidance
  unit_preferences: 'User\'s preferred unit system. You MUST use these units in all responses to the user.',
  system: 'Base unit system: "metric" or "imperial".',
  weight: 'Weight unit: "kg" or "lb".',
  temperature: 'Temperature unit: "celsius" or "fahrenheit".',

  // Power thresholds
  ftp: 'Functional Threshold Power in watts',
  indoor_ftp: 'Indoor-specific FTP in watts (only shown if different from outdoor FTP)',

  // Heart rate thresholds
  lthr: 'Lactate Threshold Heart Rate in BPM - HR at threshold effort',
  max_hr: 'Maximum heart rate in BPM',

  // HR zones
  hr_zones: 'Array of current heart rate zone objects for the athlete. Each object contains: name (e.g., "Z1", "Z2"), low_bpm, and high_bpm (null for highest zone). Note that these may be different than the Whoop HR zones, which use the Heart Rate Reserve (HRR) method.',

  // Pace thresholds
  threshold_pace: 'Threshold pace in human-readable format (e.g., "4:10/km" or "2:00/100m")',
  pace_units: 'Units for all pace values: MINS_KM (minutes per kilometer, running) or SECS_100M (seconds per 100 meters, swimming)',

  // Power zones
  power_zones: 'Array of current power zone objects for the athlete. Each object contains: name (e.g., "Active Recovery", "Endurance"), low_percent, high_percent (null for highest zone), low_watts, and high_watts (null for highest zone).',
  indoor_power_zones: 'Array of indoor-specific power zone objects for the athlete (only present if indoor_ftp differs from ftp). Same structure as power_zones.',

  // Pace zones
  pace_zones: 'Array of current pace zone objects for the athlete. Each object contains: name (e.g., "Easy", "Tempo"), low_percent, high_percent (null for highest zone), slow_pace (slower pace at low %), and fast_pace (faster pace at high %).',
};

export const INTERVALS_FIELD_DESCRIPTIONS = {
  // Response structure
  activity_id: 'Unique ID of the activity in Intervals.icu',
  intervals: 'Array of individual intervals in chronological order',
  groups: 'Summary of repeated interval sets (e.g., "5 x 56s @ 314w")',

  // Interval core fields
  type: 'Interval type: WORK (hard effort) or RECOVERY (easy/rest)',
  label: 'Custom label if assigned',
  group_id: 'ID linking similar intervals (e.g., "56s@314w91rpm")',
  start_seconds: 'Start time in seconds from activity start',
  duration: 'Duration of the interval',
  distance: 'Distance of the interval',

  // Power
  average_watts: 'Average power in watts',
  max_watts: 'Maximum power in watts',
  normalized_power: 'Normalized Power (NP) in watts',
  watts_per_kg: 'Power-to-weight ratio in watts per kilogram',
  power_zone: 'Power zone number (1-7)',
  intensity_factor: 'Intensity Factor (IF)',
  interval_tss: 'Training Stress Score for this interval',

  // Heart rate
  average_hr: 'Average heart rate in BPM',
  max_hr: 'Maximum heart rate in BPM',
  hr_decoupling: 'Power:HR decoupling percentage; positive indicates cardiac drift',

  // Cadence/stride
  average_cadence: 'Average cadence in RPM (cycling) or steps/min (running)',
  stride_length_m: 'Average stride length in meters (running)',

  // Speed
  average_speed: 'Average speed of the interval',

  // Elevation
  elevation_gain: 'Elevation gain of the interval',
  average_gradient_pct: 'Average gradient as percentage',

  // W\'bal (anaerobic capacity)
  wbal_start_j: 'W\'bal at interval start in joules; remaining anaerobic capacity',
  wbal_end_j: 'W\'bal at interval end in joules',
  joules_above_ftp: 'Work done above FTP in joules; anaerobic contribution',

  // Group fields
  count: 'Number of repetitions in this interval set',
};

export const NOTES_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique ID of the activity in Intervals.icu',
  notes: 'Array of notes/messages left by the athlete for this activity',
  id: 'Unique identifier of the note',
  athlete_id: 'Intervals.icu athlete ID who wrote the note',
  name: 'Name of the athlete who wrote the note',
  created: 'Timestamp when the note was created (ISO 8601)',
  type: 'Note type (typically TEXT)',
  content: 'The actual note content written by the athlete',
  attachment_url: 'URL to an attached file (if any)',
  attachment_mime_type: 'MIME type of the attachment (e.g., image/jpeg)',
};

export const WEATHER_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique ID of the activity in Intervals.icu',
  weather_description: 'Weather summary for the activity. Null if weather data is unavailable (e.g., indoor activities).',
};

export const POWER_CURVE_FIELD_DESCRIPTIONS = {
  // Response structure
  period_start: 'Start date of analysis period (ISO 8601 YYYY-MM-DD)',
  period_end: 'End date of analysis period (ISO 8601 YYYY-MM-DD)',
  sport: 'Sport type analyzed (cycling)',
  activity_count: 'Number of activities analyzed in this period',
  durations_analyzed: 'Human-readable list of durations analyzed (e.g., ["5s", "1min", "5min", "20min"])',

  // Curve point fields
  duration_seconds: 'Duration in seconds for this power data point',
  duration_label: 'Human-readable duration (e.g., "5s", "1min", "20min", "1hr")',
  watts: 'Best power output in watts for this duration',
  watts_per_kg: 'Power-to-weight ratio in watts per kilogram',

  // Activity curve fields
  activity_id: 'Unique ID of the activity in Intervals.icu',
  date: 'Activity date (ISO 8601)',
  weight_kg: 'Athlete weight in kilograms at time of activity',
  curve: 'Array of power curve points for this activity',

  // Summary fields (best values at key durations)
  best_5s: 'Best 5-second power (neuromuscular/sprint power)',
  best_30s: 'Best 30-second power (anaerobic capacity)',
  best_1min: 'Best 1-minute power (anaerobic endurance)',
  best_5min: 'Best 5-minute power (VO2max proxy)',
  best_20min: 'Best 20-minute power (FTP proxy)',
  best_60min: 'Best 60-minute power (endurance)',
  best_2hr: 'Best 2-hour power (long endurance)',
  estimated_ftp: 'Estimated FTP based on 95% of best 20-minute power, in watts',

  // Comparison fields
  comparison: 'Comparison data vs a previous period (only present when compare_to_* params used)',
  previous_period_start: 'Start date of comparison period',
  previous_period_end: 'End date of comparison period',
  previous_activity_count: 'Number of activities in comparison period',
  changes: 'Array of changes at each duration between periods',
  current_watts: 'Power in current period',
  previous_watts: 'Power in previous period',
  change_watts: 'Absolute change in watts (current - previous)',
  change_percent: 'Percentage change from previous period',
  improved: 'Whether performance improved (true) or declined (false)',
};

export const PACE_CURVE_FIELD_DESCRIPTIONS = {
  // Response structure
  period_start: 'Start date of analysis period (ISO 8601 YYYY-MM-DD)',
  period_end: 'End date of analysis period (ISO 8601 YYYY-MM-DD)',
  sport: 'Sport type analyzed (running or swimming)',
  gap_adjusted: 'Whether pace is gradient-adjusted (accounts for elevation changes). Only applicable for running.',
  activity_count: 'Number of activities analyzed in this period',
  distances_analyzed: 'Human-readable list of distances analyzed (e.g., ["400m", "1km", "5km"])',

  // Curve point fields
  distance_meters: 'Distance in meters for this pace data point',
  distance_label: 'Human-readable distance (e.g., "400m", "1km", "5km", "mile")',
  time_seconds: 'Best time in seconds to cover this distance',
  pace: 'Pace in human-readable format: "min:ss/km" for running, "min:ss/100m" for swimming',

  // Activity curve fields
  activity_id: 'Unique ID of the activity in Intervals.icu',
  date: 'Activity date (ISO 8601)',
  weight_kg: 'Athlete weight in kilograms at time of activity',
  curve: 'Array of pace curve points for this activity',

  // Summary fields (best values at key distances)
  // Running
  best_400m: 'Best 400m time and pace (sprint/track)',
  best_1km: 'Best 1km time and pace (middle distance)',
  best_mile: 'Best mile time and pace',
  best_5km: 'Best 5km time and pace (aerobic endurance)',
  best_10km: 'Best 10km time and pace',
  best_half_marathon: 'Best half marathon time and pace (21.1km)',
  best_marathon: 'Best marathon time and pace (42.2km)',
  // Swimming
  best_100m: 'Best 100m time and pace (sprint)',
  best_200m: 'Best 200m time and pace',
  best_800m: 'Best 800m time and pace',
  best_1500m: 'Best 1500m time and pace (Olympic distance)',
  best_half_iron_swim: 'Best Half Ironman swim time and pace (1.9km)',
  best_iron_swim: 'Best Ironman swim time and pace (3.8km)',

  // Comparison fields
  comparison: 'Comparison data vs a previous period (only present when compare_to_* params used)',
  previous_period_start: 'Start date of comparison period',
  previous_period_end: 'End date of comparison period',
  previous_activity_count: 'Number of activities in comparison period',
  changes: 'Array of changes at each distance between periods',
  current_time_seconds: 'Time in current period',
  previous_time_seconds: 'Time in previous period',
  change_seconds: 'Absolute change in seconds (current - previous, negative = faster)',
  change_percent: 'Percentage change from previous period (negative = faster)',
  improved: 'Whether performance improved (true = faster) or declined (false = slower)',
};

export const HR_CURVE_FIELD_DESCRIPTIONS = {
  // Response structure
  period_start: 'Start date of analysis period (ISO 8601 YYYY-MM-DD)',
  period_end: 'End date of analysis period (ISO 8601 YYYY-MM-DD)',
  sport: 'Sport type analyzed (cycling, running, swimming, or null for all sports)',
  activity_count: 'Number of activities analyzed in this period',
  durations_analyzed: 'Human-readable list of durations analyzed (e.g., ["5s", "1min", "5min", "20min"])',

  // Curve point fields
  duration_seconds: 'Duration in seconds for this HR data point',
  duration_label: 'Human-readable duration (e.g., "5s", "1min", "20min", "1hr")',
  bpm: 'Maximum sustained heart rate in beats per minute for this duration',

  // Activity curve fields
  activity_id: 'Unique ID of the activity in Intervals.icu',
  date: 'Activity date (ISO 8601)',
  curve: 'Array of HR curve points for this activity',

  // Summary fields (max values at key durations)
  max_1s: 'Maximum 1-second HR (peak HR)',
  max_5s: 'Maximum 5-second sustained HR',
  max_1min: 'Maximum 1-minute sustained HR',
  max_5min: 'Maximum 5-minute sustained HR',
  max_20min: 'Maximum 20-minute sustained HR (threshold proxy)',
  max_2hr: 'Maximum 2-hour sustained HR (endurance)',

  // Comparison fields
  comparison: 'Comparison data vs a previous period (only present when compare_to_* params used)',
  previous_period_start: 'Start date of comparison period',
  previous_period_end: 'End date of comparison period',
  previous_activity_count: 'Number of activities in comparison period',
  changes: 'Array of changes at each duration between periods',
  current_bpm: 'HR in current period',
  previous_bpm: 'HR in previous period',
  change_bpm: 'Absolute change in BPM (current - previous)',
  change_percent: 'Percentage change from previous period',
};

export const WELLNESS_FIELD_DESCRIPTIONS = {
  // Wellness trends response structure
  period_days: 'Number of days in the wellness data period',
  start_date: 'Start date of wellness data period (ISO 8601 YYYY-MM-DD)',
  end_date: 'End date of wellness data period (ISO 8601 YYYY-MM-DD)',
  data: 'Array of daily wellness entries, sorted oldest to newest',

  // Daily wellness fields
  date: 'Date of wellness entry (ISO 8601 YYYY-MM-DD)',
  weight: 'Body weight with unit (e.g., "74.8 kg"). Only present if recorded for this day.',
};

export const DAILY_SUMMARY_FIELD_DESCRIPTIONS = {
  // Top-level daily summary fields
  current_date: 'Current date and time in the user\'s local timezone (ISO 8601 with timezone offset, e.g., "2024-12-25T10:30:45-05:00"). Use this to understand the time of day when the summary was requested; that context may be important for the metrics shown.',
  workouts_completed: 'Number of workouts completed so far today',
  workouts_planned: 'Number of workouts planned for today',
  tss_completed: 'Total Training Stress Score from completed workouts',
  tss_planned: 'Total expected Training Stress Score from planned workouts',
};

type FieldCategory =
  | 'workout'
  | 'whoop'
  | 'recovery'
  | 'fitness'
  | 'planned'
  | 'athlete_profile'
  | 'sport_settings'
  | 'intervals'
  | 'notes'
  | 'weather'
  | 'power_curve'
  | 'pace_curve'
  | 'hr_curve'
  | 'wellness'
  | 'daily_summary';

/**
 * Get descriptions for a specific category
 */
export function getFieldDescriptions(category: FieldCategory): Record<string, string> {
  switch (category) {
    case 'workout':
      return WORKOUT_FIELD_DESCRIPTIONS;
    case 'whoop':
      return WHOOP_FIELD_DESCRIPTIONS;
    case 'recovery':
      return RECOVERY_FIELD_DESCRIPTIONS;
    case 'fitness':
      return FITNESS_FIELD_DESCRIPTIONS;
    case 'planned':
      return PLANNED_WORKOUT_FIELD_DESCRIPTIONS;
    case 'athlete_profile':
      return ATHLETE_PROFILE_FIELD_DESCRIPTIONS;
    case 'sport_settings':
      return SPORT_SETTINGS_FIELD_DESCRIPTIONS;
    case 'intervals':
      return INTERVALS_FIELD_DESCRIPTIONS;
    case 'notes':
      return NOTES_FIELD_DESCRIPTIONS;
    case 'weather':
      return WEATHER_FIELD_DESCRIPTIONS;
    case 'power_curve':
      return POWER_CURVE_FIELD_DESCRIPTIONS;
    case 'pace_curve':
      return PACE_CURVE_FIELD_DESCRIPTIONS;
    case 'hr_curve':
      return HR_CURVE_FIELD_DESCRIPTIONS;
    case 'wellness':
      return WELLNESS_FIELD_DESCRIPTIONS;
    case 'daily_summary':
      return DAILY_SUMMARY_FIELD_DESCRIPTIONS;
  }
}

/**
 * Combine field descriptions for a response that includes multiple types
 */
export function combineFieldDescriptions(
  ...categories: FieldCategory[]
): Record<string, string> {
  return categories.reduce(
    (acc, category) => ({ ...acc, ...getFieldDescriptions(category) }),
    {}
  );
}

