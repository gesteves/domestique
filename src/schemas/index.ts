/**
 * Zod response schemas for MCP tool outputs.
 *
 * Each tool exports a `<tool>OutputSchema` raw shape used as the tool's
 * `outputSchema` per the 2025-11-25 MCP spec. Field-level `.describe()` calls
 * carry through to the JSON Schema that clients receive via `tools/list`,
 * so the model learns what each field means without us injecting a
 * `field_descriptions` glossary into every response payload.
 *
 * Schemas use `.optional()` liberally because the response builder strips
 * null/undefined fields to save tokens — required fields would fail validation
 * when their value is null in source data.
 */

import { z } from 'zod';

/**
 * Optional actionable next-step suggestions emitted by the response builder
 * when a tool's hint generators fire. Schemas that opt in include this field
 * so the validator accepts the injected `hints` array. Hints reach the model
 * via structuredContent; clients that only read `content` see them in the
 * serialized JSON copy.
 *
 * Avoid underscore prefixes here — some MCP clients (e.g. MCP Inspector) treat
 * `_*` properties as protocol-private and filter them out of schema validation,
 * which would cause the injected hints to look like an extra property.
 */
const hintsField = z
  .array(z.string())
  .optional()
  .describe('Actionable next-step suggestions based on the data. Read these and consider following them when relevant.');

// ============================================
// Zones (heart rate, power, pace, heat)
// ============================================

const HRZoneZ = z.object({
  name: z.string().optional().describe('Zone name (e.g., "Recovery", "Endurance", "Threshold")'),
  low_hr: z.string().optional().describe('Lower bound of the heart rate range for this zone'),
  high_hr: z.string().nullable().optional().describe('Upper bound of the heart rate range. Null for the top zone (no upper bound)'),
  time_in_zone: z.string().optional().describe('Total time spent in this zone'),
}).passthrough();

const PowerZoneZ = z.object({
  name: z.string().optional().describe('Zone name (e.g., "Recovery", "Endurance", "Sweet Spot", "VO2 Max")'),
  low_pct: z.string().optional().describe('Lower bound of the zone, as a percentage of FTP'),
  high_pct: z.string().nullable().optional().describe('Upper bound of the zone as a percentage of FTP. Null for the top zone (no upper bound)'),
  low_power: z.string().optional().describe('Lower bound of the zone in absolute power'),
  high_power: z.string().nullable().optional().describe('Upper bound of the zone in absolute power. Null for the top zone (no upper bound)'),
  time_in_zone: z.string().optional().describe('Total time spent in this zone'),
}).passthrough();

const PaceZoneZ = z.object({
  name: z.string().optional().describe('Zone name (e.g., "Easy", "Marathon", "Threshold", "Interval")'),
  low_pct: z.string().optional().describe('Lower bound of the zone, as a percentage of threshold pace'),
  high_pct: z.string().nullable().optional().describe('Upper bound of the zone as a percentage of threshold pace. Null for the top zone (no upper bound)'),
  slow_pace: z.string().nullable().optional().describe('Slower edge of the zone (longer time per unit distance). Null for the slowest zone (no lower bound)'),
  fast_pace: z.string().nullable().optional().describe('Faster edge of the zone (shorter time per unit distance). Null for the fastest zone (no upper bound)'),
  time_in_zone: z.string().optional().describe('Total time spent in this zone'),
}).passthrough();

const HeatZoneZ = z.object({
  name: z.string().optional().describe('Zone name (e.g., "No Heat Strain", "Moderate Heat Strain", "High Heat Strain", "Extremely High Heat Strain")'),
  low_heat_strain_index: z.number().optional().describe('Lower bound of the Heat Strain Index range for this zone'),
  high_heat_strain_index: z.number().nullable().optional().describe('Upper bound of the Heat Strain Index range. Null for the top zone (no upper bound)'),
  time_in_zone: z.string().optional().describe('Total time spent in this zone'),
}).passthrough();

// ============================================
// Workout intervals & notes (used inside workouts)
// ============================================

const WorkoutNoteZ = z.object({
  id: z.string().optional().describe('Unique identifier of the note'),
  athlete_id: z.string().optional().describe('Intervals.icu athlete ID who wrote the note'),
  name: z.string().optional().describe('Name of the athlete who wrote the note'),
  created: z.string().optional().describe('Timestamp when the note was created (ISO 8601)'),
  type: z.string().optional().describe('Note type (typically TEXT)'),
  content: z.string().optional().describe('The actual note content written by the athlete'),
  attachment_url: z.string().optional().describe('URL to an attached file (if any)'),
  attachment_mime_type: z.string().optional().describe('MIME type of the attachment (e.g., image/jpeg)'),
}).passthrough();

const WorkoutIntervalZ = z.object({
  type: z.enum(['WORK', 'RECOVERY']).optional().describe('Interval type: WORK (hard effort) or RECOVERY (easy/rest)'),
  label: z.string().optional().describe('Custom label if assigned'),
  group_id: z.string().optional().describe('ID linking similar intervals (e.g., "56s@314w91rpm")'),
  start_seconds: z.number().optional().describe('Start time in seconds from activity start'),
  duration: z.string().optional().describe('Duration of this interval'),
  distance: z.string().optional().describe('Distance covered during this interval'),
  average_power: z.string().optional().describe('Average power during this interval'),
  max_power: z.string().optional().describe('Peak power reached during this interval'),
  normalized_power: z.string().optional().describe('Normalized Power (NP) during this interval'),
  power_to_weight: z.string().optional().describe('Power-to-weight ratio during this interval'),
  power_zone: z.number().optional().describe('Power zone number (1-7)'),
  intensity_factor: z.number().optional().describe('Intensity Factor (IF) for this interval'),
  interval_tss: z.number().optional().describe('Training Stress Score contributed by this interval'),
  average_hr: z.string().optional().describe('Average heart rate during this interval'),
  max_hr: z.string().optional().describe('Peak heart rate reached during this interval'),
  hr_decoupling: z.string().optional().describe('Power:HR decoupling during this interval; positive indicates cardiac drift'),
  average_cadence: z.string().optional().describe('Average cadence during this interval'),
  stride_length: z.string().optional().describe('Average stride length during this interval (running)'),
  average_speed: z.string().optional().describe('Average speed during this interval'),
  elevation_gain: z.string().optional().describe('Elevation gain during this interval'),
  average_gradient: z.string().optional().describe('Average gradient'),
  wbal_start: z.string().optional().describe("W'bal at interval start; remaining anaerobic capacity"),
  wbal_end: z.string().optional().describe("W'bal at interval end"),
  energy_above_ftp: z.string().optional().describe('Work done above FTP; anaerobic contribution'),
  min_heat_strain_index: z.number().optional().describe('Minimum heat strain index during the interval'),
  max_heat_strain_index: z.number().optional().describe('Maximum heat strain index during the interval'),
  median_heat_strain_index: z.number().optional().describe('Median heat strain index during the interval'),
  start_heat_strain_index: z.number().optional().describe('Heat strain index at the start of the interval'),
  end_heat_strain_index: z.number().optional().describe('Heat strain index at the end of the interval'),
  min_ambient_temperature: z.string().optional().describe("Minimum ambient temperature during the interval (water for swimming, air otherwise), recorded by the user's watch or bike computer"),
  max_ambient_temperature: z.string().optional().describe('Maximum ambient temperature during the interval'),
  median_ambient_temperature: z.string().optional().describe('Median ambient temperature during the interval. Use this when reporting water temperature for swimming'),
  start_ambient_temperature: z.string().optional().describe('Ambient temperature at the start of the interval'),
  end_ambient_temperature: z.string().optional().describe('Ambient temperature at the end of the interval'),
}).passthrough();

const IntervalGroupZ = z.object({
  id: z.string().optional().describe('Group identifier (e.g., "56s@314w91rpm" - human-readable summary of the repeated effort)'),
  count: z.number().optional().describe('Number of repetitions in this interval set'),
  average_power: z.string().optional().describe('Average power across all repetitions in this group'),
  average_hr: z.string().optional().describe('Average heart rate across all repetitions in this group'),
  average_cadence: z.string().optional().describe('Average cadence across all repetitions in this group'),
  average_speed: z.string().optional().describe('Average speed across all repetitions in this group'),
  distance: z.string().optional().describe('Total distance covered across all repetitions in this group'),
  duration: z.string().optional().describe('Total duration across all repetitions in this group'),
  elevation_gain: z.string().optional().describe('Total elevation gain across all repetitions in this group'),
}).passthrough();

const PlayedSongZ = z.object({
  name: z.string().optional().describe('Track title'),
  played_at: z.string().optional().describe("When the song was scrobbled, in the user's local timezone"),
  url: z.string().optional().describe('Last.fm track URL'),
  album: z.string().optional().describe('Album name'),
  artist: z.string().optional().describe('Artist name'),
  loved: z.literal(true).optional().describe('Set to true when the user has marked this track as loved on Last.fm; omitted otherwise'),
}).passthrough();

// ============================================
// Whoop matched data (embedded in workouts)
// ============================================

const WhoopZoneDurationsZ = z.object({
  zone_0: z.string().optional().describe('Time in Whoop zone 0 (0-50% of heart rate reserve, very light)'),
  zone_1: z.string().optional().describe('Time in Whoop zone 1 (50-60% of heart rate reserve, light)'),
  zone_2: z.string().optional().describe('Time in Whoop zone 2 (60-70% of heart rate reserve, moderate)'),
  zone_3: z.string().optional().describe('Time in Whoop zone 3 (70-80% of heart rate reserve, vigorous)'),
  zone_4: z.string().optional().describe('Time in Whoop zone 4 (80-90% of heart rate reserve, hard)'),
  zone_5: z.string().optional().describe('Time in Whoop zone 5 (90-100% of heart rate reserve, maximum)'),
}).passthrough();

const WhoopMatchedDataZ = z.object({
  strain_score: z.number().optional().describe('Whoop cardiovascular strain score for the matched workout (0-21, logarithmic). Light: 0-9, Moderate: 10-13, High: 14-17, All out: 18-21'),
  average_heart_rate: z.string().optional().describe('Average heart rate Whoop recorded during this matched workout'),
  max_heart_rate: z.string().optional().describe('Peak heart rate Whoop recorded during this matched workout'),
  calories: z.number().optional().describe('Estimated calories Whoop calculated for this matched workout'),
  distance: z.string().optional().describe('Distance Whoop recorded for this matched workout. Only present if Whoop captured GPS or sensor distance'),
  elevation_gain: z.string().optional().describe('Total elevation gain Whoop recorded during this matched workout (ascent only, does not net out descent)'),
  zone_durations: WhoopZoneDurationsZ.optional().describe('Time spent in each Whoop HR zone during this matched workout. Whoop uses heart rate reserve, so zone boundaries may differ from Intervals.icu HR zones'),
}).passthrough();

// ============================================
// Workout (summary vs detail)
// ============================================
//
// WorkoutSummaryZ is the always-present field set returned by list endpoints
// (get_workout_history, get_todays_summary.completed_workouts). WorkoutDetailZ
// extends it with the heavier fields that only get fetched for single-workout
// detail views (get_workout_details, get_todays_workouts.completed_workouts).

const WorkoutSummaryZ = z.object({
  id: z.string().optional().describe('Unique ID of the completed activity in Intervals.icu'),
  start_time: z.string().optional().describe("Activity start time in the user's local timezone"),
  activity_type: z.string().optional().describe('Sport or discipline of the activity'),
  name: z.string().optional().describe('Name of the activity'),
  description: z.string().optional().describe('Description of the activity'),
  duration: z.string().optional().describe('Total duration of the activity'),
  distance: z.string().optional().describe('Total distance of the activity'),
  source: z.string().optional().describe('Source of the data for this activity'),

  intervals_icu_url: z.string().optional().describe('URL to view this activity on Intervals.icu'),
  garmin_connect_url: z.string().optional().describe('URL to view this activity on Garmin Connect'),
  zwift_url: z.string().optional().describe('URL to view this activity on Zwift'),
  strava_url: z.string().optional().describe('URL to view this activity on Strava'),

  unavailable: z.boolean().optional().describe("True if this workout's full data is unavailable (e.g., Strava-only)"),
  unavailable_reason: z.string().optional().describe('Human-readable reason why the workout is unavailable'),

  tss: z.number().optional().describe('Training Stress Score (TSS)'),
  load: z.number().optional().describe('Training load (equivalent to TSS for power-based activities)'),
  intensity_factor: z.number().optional().describe('Intensity Factor (IF), how hard it was compared to your FTP'),
  trimp: z.number().optional().describe('Training Impulse, training load derived from average HR relative to resting/max HR and moving time'),
  session_rpe: z.number().optional().describe('Session RPE = RPE × duration in minutes'),
  icu_strain_score: z.number().optional().describe("Intervals.icu strain score (XSS-like, power-based). Unrelated to Whoop's strain score"),

  normalized_power: z.string().optional().describe('Normalized Power (NP) across the entire activity'),
  average_power: z.string().optional().describe('Average power across the entire activity'),
  ftp: z.string().optional().describe('FTP used for this activity'),
  eftp: z.string().optional().describe('FTP estimated by Intervals.icu for the user'),
  activity_eftp: z.string().optional().describe('FTP estimated by Intervals.icu from this activity alone'),
  w_prime: z.string().optional().describe("W' (W prime), anaerobic work capacity"),
  pmax: z.string().optional().describe('Highest instant power producible for a very short duration'),
  work: z.string().optional().describe('Total work done'),
  lthr: z.string().optional().describe('Lactate Threshold Heart Rate at time of activity'),

  average_heart_rate: z.string().optional().describe('Average heart rate across the entire activity'),
  max_heart_rate: z.string().optional().describe('Peak heart rate reached during the activity'),
  hrrc: z.number().optional().describe('Heart rate recovery, the largest HR drop over 60s starting from at least threshold'),

  average_speed: z.string().optional().describe('Average speed during the activity'),
  max_speed: z.string().optional().describe('Maximum speed during the activity'),

  average_cadence: z.string().optional().describe('Average cadence across the entire activity'),
  max_cadence: z.string().optional().describe('Peak cadence reached during the activity'),

  variability_index: z.number().optional().describe('Variability Index (VI)'),
  power_hr_ratio: z.number().optional().describe('Power:HR ratio (output power per input heart rate)'),
  efficiency_factor: z.number().optional().describe('Efficiency Factor (EF) = NP / Avg HR'),

  coasting_time: z.string().optional().describe('Total time spent coasting'),
  coasting_percentage: z.string().optional().describe('Share of ride time spent coasting'),

  rpe: z.string().optional().describe('Rate of Perceived Exertion (1=Nothing at all, 2=Very easy, 3=Easy, 4=Comfortable, 5=Slightly challenging, 6=Difficult, 7=Hard, 8=Very hard, 9=Extremely hard, 10=Max effort)'),
  feel: z.string().optional().describe('How the athlete felt (1=Strong, 2=Good, 3=Normal, 4=Poor, 5=Weak)'),

  ctl_at_activity: z.number().optional().describe('CTL (fitness) at time of activity'),
  atl_at_activity: z.number().optional().describe('ATL (fatigue) at time of activity'),
  tsb_at_activity: z.number().optional().describe('TSB (form) at time of activity'),

  elevation_gain: z.string().optional().describe('Elevation gain during the activity'),
  average_altitude: z.string().optional().describe('Average altitude'),
  min_altitude: z.string().optional().describe('Minimum altitude'),
  max_altitude: z.string().optional().describe('Maximum altitude'),

  calories: z.number().optional().describe('Estimated calories burned'),
  carbs_used: z.string().optional().describe('Estimated carbohydrates used'),
  carbs_intake: z.string().optional().describe("Carbohydrates consumed during activity. Absence doesn't imply lack of consumption"),
  carbs_per_hour: z.string().optional().describe('Carbohydrate intake rate during the activity. Only present when both intake and usage were logged and positive'),

  weight: z.string().optional().describe('Athlete weight at time of activity'),
  resting_hr: z.string().optional().describe('Resting heart rate at time of activity'),

  average_stride: z.string().optional().describe('Average stride length'),
  gap: z.string().optional().describe('Gradient Adjusted Pace'),

  pool_length: z.string().optional().describe('Length of the pool'),
  lengths: z.number().optional().describe('Number of pool lengths swum'),

  is_indoor: z.boolean().optional().describe('Whether activity was indoor'),
  is_commute: z.boolean().optional().describe('Whether activity was marked as a commute'),
  is_race: z.boolean().optional().describe('Whether activity was marked as a race'),

  hr_zones: z.array(HRZoneZ).optional().describe('Heart rate zone objects for the time of activity (may differ from current athlete profile zones)'),
  power_zones: z.array(PowerZoneZ).optional().describe('Power zone objects for the time of activity (may differ from current athlete profile zones)'),
  pace_zones: z.array(PaceZoneZ).optional().describe('Pace zone objects for the time of activity (may differ from current athlete profile zones)'),

  heat_zones: z.array(HeatZoneZ).optional().describe('Heat zone objects based on the Heat Strain Index (HSI). Only present when heat strain data from a CORE body temperature sensor is available.'),
  max_heat_strain_index: z.number().optional().describe('Maximum Heat Strain Index (HSI) reached during the activity, recorded by a CORE body temperature sensor'),
  median_heat_strain_index: z.number().optional().describe('Median Heat Strain Index (HSI) throughout the activity, recorded by a CORE body temperature sensor'),

  min_ambient_temperature: z.string().optional().describe("Minimum ambient temperature during the activity (water for swimming, air otherwise), recorded by the user's watch or bike computer"),
  max_ambient_temperature: z.string().optional().describe('Maximum ambient temperature during the activity'),
  median_ambient_temperature: z.string().optional().describe('Median ambient temperature during the activity. Use this when reporting water temperature for swimming'),
  start_ambient_temperature: z.string().optional().describe('Ambient temperature at the start of the activity'),
  end_ambient_temperature: z.string().optional().describe('Ambient temperature at the end of the activity'),

  notes: z.array(WorkoutNoteZ).optional().describe('Notes/messages left by the athlete or others (e.g., a coach) for this activity'),

  // Whoop match data — present in summary too because matching is cheap and high-signal
  whoop: WhoopMatchedDataZ.nullable().optional().describe('Matched Whoop activity data. Null when Whoop is not configured or no match was found'),
  whoop_unavailable: z.boolean().optional().describe('True when the Whoop fetch failed for this date range; absence does not mean no Whoop activity'),
}).passthrough();

const WorkoutDetailZ = WorkoutSummaryZ.extend({
  intervals: z.array(WorkoutIntervalZ).optional().describe('Individual workout intervals with detailed metrics (power, HR, cadence, duration, timing)'),
  interval_groups: z.array(IntervalGroupZ).optional().describe('Grouped intervals showing repeated efforts (e.g., "4x 5m @ 200w")'),
  rolling_ftp: z.string().optional().describe('Rolling FTP estimate from recent activities'),
  rolling_ftp_delta: z.string().optional().describe('Change in rolling FTP from previous value (positive = increasing)'),
  interval_summary: z.array(z.string()).optional().describe('Human-readable summary of intervals (e.g., ["2x 5m 133w", "3x 10m 202w"])'),
  power_load: z.number().optional().describe('Training load calculated from power data (TSS)'),
  hr_load: z.number().optional().describe('Training load calculated from heart rate data'),
  pace_load: z.number().optional().describe('Training load calculated from pace data (running/swimming)'),
  power_hr_z2: z.number().optional().describe('Power-to-HR ratio in Zone 2 (aerobic efficiency)'),
  power_hr_z2_mins: z.string().optional().describe('Amount of Z2 data used to calculate the ratio'),
  cadence_z2: z.string().optional().describe('Average cadence during Zone 2 effort'),
  compliance: z.string().optional().describe('Workout compliance against the planned target. "0%" means no planned workout was matched'),
  weather_description: z.string().optional().describe('Weather summary for outdoor activities. Not included for indoor activities'),
  played_songs: z.array(PlayedSongZ).optional().describe('Songs scrobbled to Last.fm during the activity, in chronological order'),
}).passthrough();

// ============================================
// Whoop sleep / recovery / strain
// ============================================

const WhoopSleepSummaryZ = z.object({
  total_in_bed_time: z.string().optional().describe('Total time the user spent in bed'),
  total_awake_time: z.string().optional().describe('Total time the user spent awake during the sleep period'),
  total_no_data_time: z.string().optional().describe("Total time Whoop didn't receive data from the user"),
  total_light_sleep_time: z.string().optional().describe('Total time the user spent in light sleep'),
  total_slow_wave_sleep_time: z.string().optional().describe('Total time the user spent in deep/slow wave sleep'),
  total_rem_sleep_time: z.string().optional().describe('Total time the user spent in REM sleep'),
  total_restorative_sleep: z.string().optional().describe('Total time the user spent in restorative sleep (slow wave + REM)'),
  sleep_cycle_count: z.number().optional().describe("Number of sleep cycles during the user's sleep"),
  disturbance_count: z.number().optional().describe('Number of disturbances during sleep'),
}).passthrough();

const WhoopSleepNeededZ = z.object({
  total_sleep_needed: z.string().optional().describe('Total sleep needed by the user; sum of all components'),
  baseline: z.string().optional().describe('Sleep needed based on historical trends'),
  need_from_sleep_debt: z.string().optional().describe('Difference between sleep needed and what the user actually got'),
  need_from_recent_strain: z.string().optional().describe("Additional sleep need accrued based on the user's strain"),
  need_from_recent_nap: z.string().optional().describe('Reduction in sleep need from recent naps (negative or zero)'),
}).passthrough();

const WhoopNapZ = z.object({
  nap_summary: WhoopSleepSummaryZ.optional().describe("Summary of the nap's sleep stages"),
  respiratory_rate: z.string().optional().describe('Respiratory rate during the nap'),
  nap_start: z.string().optional().describe("The approximate time the nap started, in the user's local timezone"),
  nap_end: z.string().optional().describe("The approximate time the nap ended, in the user's local timezone"),
}).passthrough();

const WhoopSleepZ = z.object({
  sleep_summary: WhoopSleepSummaryZ.optional().describe("Summary of the user's sleep stages"),
  sleep_needed: WhoopSleepNeededZ.optional().describe('Breakdown of sleep needed prior to this sleep'),
  respiratory_rate: z.string().optional().describe('Respiratory rate during sleep'),
  sleep_performance: z.string().optional().describe('Time asleep ÷ sleep needed (Optimal: ≥85%, Sufficient: 70-85%, Poor: <70%)'),
  sleep_consistency: z.string().optional().describe('Similarity of this sleep/wake times to the previous day'),
  sleep_efficiency: z.string().optional().describe('Share of time in bed actually asleep'),
  sleep_performance_level: z.string().optional().describe("Whoop's label for sleep performance: Optimal, Sufficient, or Poor"),
  sleep_performance_level_description: z.string().optional().describe("Whoop's official description for this sleep performance level"),
  sleep_start: z.string().optional().describe("The approximate time the user fell asleep, in the user's local timezone"),
  sleep_end: z.string().optional().describe("The approximate time the user woke up, in the user's local timezone"),
  naps: z.array(WhoopNapZ).optional().describe('Naps taken during this cycle'),
}).passthrough();

const WhoopRecoveryZ = z.object({
  date: z.string().optional().describe('Date of recovery data (ISO 8601)'),
  recovery_score: z.string().optional().describe("Reflects the body's readiness for strain. Sufficient: ≥67%, Adequate: 34-66%, Low: <34%"),
  recovery_level: z.string().optional().describe("Whoop's label: Sufficient, Adequate, or Low"),
  recovery_level_description: z.string().optional().describe("Whoop's official description for this recovery level"),
  hrv_rmssd: z.string().optional().describe('Heart Rate Variability (RMSSD)'),
  resting_heart_rate: z.string().optional().describe('Resting heart rate, measured during slow wave sleep'),
  spo2: z.string().optional().describe("Oxygen saturation in the user's blood"),
  skin_temp: z.string().optional().describe("The user's skin temperature"),
}).passthrough();

const WhoopRecoveryTrendEntryZ = z.object({
  date: z.string().optional().describe('Date of the entry'),
  sleep: WhoopSleepZ.optional(),
  recovery: WhoopRecoveryZ.optional(),
}).passthrough();

const WhoopBodyMeasurementsZ = z.object({
  height: z.string().optional().describe("The user's height"),
  weight: z.string().optional().describe("The user's weight"),
  max_heart_rate: z.string().optional().describe("The user's maximum heart rate calculated by Whoop"),
}).passthrough();

const StrainActivityZ = z.object({
  id: z.string().optional().describe('Whoop activity ID. Distinct from Intervals.icu activity IDs — these activities are logged in the Whoop app and may not have a corresponding Intervals.icu workout'),
  activity_type: z.string().optional().describe('Activity type as labeled in the Whoop app (e.g., "Running", "Cycling", "Strength")'),
  start_time: z.string().optional().describe("Activity start time in the user's local timezone"),
  end_time: z.string().optional().describe("Activity end time in the user's local timezone"),
  duration: z.string().optional().describe('Total duration of this Whoop-app-logged activity'),
  strain_score: z.number().optional().describe('Whoop strain score for this single activity (0-21, logarithmic). Distinct from the day-level strain in the parent object'),
  average_heart_rate: z.string().optional().describe('Average heart rate during this Whoop-app-logged activity'),
  max_heart_rate: z.string().optional().describe('Maximum heart rate during this Whoop-app-logged activity'),
  calories: z.number().optional().describe('Estimated calories burned during this activity'),
  distance: z.string().optional().describe('Distance covered during this activity. Only present when Whoop captured GPS or sensor distance'),
  elevation_gain: z.string().optional().describe('Total elevation gain during this activity. Only present when Whoop captured altitude'),
  zone_durations: WhoopZoneDurationsZ.optional().describe('Time spent in each Whoop HR zone during this activity'),
}).passthrough();

const StrainDataZ = z.object({
  date: z.string().optional().describe("Calendar date this strain summary covers, in the user's local timezone"),
  strain_score: z.number().optional().describe('Whoop cardiovascular strain score for the whole day (0-21, logarithmic). Light: 0-9, Moderate: 10-13, High: 14-17, All out: 18-21'),
  strain_level: z.string().optional().describe("Whoop's label for the day's strain: Light, Moderate, High, or All out"),
  strain_level_description: z.string().optional().describe("Whoop's official description for this strain level"),
  average_heart_rate: z.string().optional().describe('Average heart rate across the entire day'),
  max_heart_rate: z.string().optional().describe('Peak heart rate reached during the day'),
  calories: z.number().optional().describe('Total estimated calories burned across the day, per Whoop'),
  activities: z.array(StrainActivityZ).optional().describe("Activities logged in the user's Whoop app on this day. May be empty"),
}).passthrough();

// ============================================
// Fitness / training load
// ============================================

const DailyTrainingLoadZ = z.object({
  date: z.string().optional().describe('Date of fitness metrics (ISO 8601)'),
  ctl: z.number().optional().describe('Chronic Training Load (fitness) — 42-day exponentially weighted average of daily TSS'),
  atl: z.number().optional().describe('Acute Training Load (fatigue) — 7-day exponentially weighted average of daily TSS'),
  tsb: z.number().optional().describe('Training Stress Balance (form) = CTL - ATL. -10 to +25 typical for optimal performance'),
  ramp_rate: z.number().optional().describe('Rate of CTL change per week. Safe: 3-7. Aggressive: 7+. Injury risk above 10'),
  ctl_load: z.number().optional().describe("Weighted contribution to CTL from this day's training"),
  atl_load: z.number().optional().describe("Weighted contribution to ATL from this day's training"),
}).passthrough();

const TrainingLoadSummaryZ = z.object({
  current_ctl: z.number().optional().describe('Most recent CTL value (current fitness level)'),
  current_atl: z.number().optional().describe('Most recent ATL value (current fatigue level)'),
  current_tsb: z.number().optional().describe('Most recent TSB value (current form)'),
  ctl_trend: z.string().optional().describe('CTL trend direction: increasing, stable, or decreasing'),
  avg_ramp_rate: z.number().optional().describe('Average weekly CTL change rate over the period'),
  peak_ctl: z.number().optional().describe('Highest CTL reached during the period'),
  peak_ctl_date: z.string().optional().describe('Date when peak CTL was reached'),
  acwr: z.number().optional().describe('Acute:Chronic Workload Ratio = ATL/CTL. Optimal: 0.8-1.3. Caution: 1.3-1.5. High injury risk: >1.5'),
  acwr_status: z.string().optional().describe('ACWR risk assessment: optimal, low_risk, caution, or high_risk'),
}).passthrough();

const FitnessMetricsZ = z.object({
  date: z.string().optional(),
  ctl: z.number().optional().describe('Chronic Training Load (fitness)'),
  atl: z.number().optional().describe('Acute Training Load (fatigue)'),
  tsb: z.number().optional().describe('Training Stress Balance (form) = CTL - ATL'),
  ramp_rate: z.number().optional().describe('Weekly CTL change rate'),
  ctl_load: z.number().optional().describe("Weighted contribution to CTL from today's training"),
  atl_load: z.number().optional().describe("Weighted contribution to ATL from today's training"),
}).passthrough();

// ============================================
// Wellness
// ============================================

const WellnessFieldsShape = {
  weight: z.string().optional().describe('Body weight'),
  resting_hr: z.string().optional().describe('Resting heart rate'),
  hrv: z.string().optional().describe('Heart rate variability (rMSSD)'),
  hrv_sdnn: z.string().optional().describe('Heart rate variability (SDNN)'),
  menstrual_phase: z.string().optional().describe('Current menstrual cycle phase'),
  menstrual_phase_predicted: z.string().optional().describe('Predicted menstrual cycle phase'),
  kcal_consumed: z.number().optional().describe('Calories consumed'),
  carbs: z.string().optional().describe('Carbohydrates consumed'),
  protein: z.string().optional().describe('Protein consumed'),
  fat_total: z.string().optional().describe('Total fat consumed'),
  sleep_duration: z.string().optional().describe('Sleep duration (e.g., "8h 10m")'),
  sleep_score: z.number().optional().describe('Sleep score (0-100)'),
  sleep_quality: z.number().optional().describe('Subjective sleep quality: 1=GREAT, 2=GOOD, 3=AVG, 4=POOR'),
  avg_sleeping_hr: z.string().optional().describe('Average heart rate during sleep'),
  soreness: z.number().optional().describe('Pre-training soreness: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME'),
  fatigue: z.number().optional().describe('Pre-training fatigue: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME'),
  stress: z.number().optional().describe('Stress: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME'),
  mood: z.number().optional().describe('Mood: 1=GREAT, 2=GOOD, 3=OK, 4=GRUMPY'),
  motivation: z.number().optional().describe('Motivation: 1=EXTREME, 2=HIGH, 3=AVG, 4=LOW'),
  injury: z.number().optional().describe('Injury status: 1=NONE, 2=NIGGLE, 3=POOR, 4=INJURED'),
  hydration: z.number().optional().describe('Hydration: 1=GOOD, 2=OK, 3=POOR, 4=BAD'),
  spo2: z.string().optional().describe('Blood oxygen saturation'),
  blood_pressure: z.string().optional().describe('Blood pressure as systolic/diastolic'),
  hydration_volume: z.string().optional().describe('Volume of fluids consumed'),
  respiration: z.string().optional().describe('Respiration rate'),
  readiness: z.number().optional().describe('Overall readiness score (0-100)'),
  baevsky_si: z.number().optional().describe('Baevsky stress index'),
  blood_glucose: z.string().optional().describe('Blood glucose level'),
  lactate: z.string().optional().describe('Blood lactate level'),
  body_fat: z.string().optional().describe('Body fat'),
  abdomen: z.string().optional().describe('Abdominal circumference'),
  vo2max: z.string().optional().describe('Estimated VO2max'),
  steps: z.number().optional().describe('Step count for the day'),
  comments: z.string().optional().describe('User notes/comments for the day'),
  heat_adaptation_score: z.string().optional().describe('Heat adaptation score from CORE body temperature sensor'),
  sources: z.record(z.string(), z.string()).optional().describe('Maps each present wellness field to the provider feeding it ("garmin", "whoop", "oura", "core body temperature sensor"), inferred from the athlete\'s provider configuration. Fields outside any configured provider are omitted (likely manual entry, though manually entered values may still appear with a configured source).'),
} as const;

const DailyWellnessZ = z.object({
  date: z.string().optional().describe('Date of wellness entry (ISO 8601)'),
  ...WellnessFieldsShape,
}).passthrough();

const WellnessDataZ = z.object(WellnessFieldsShape).passthrough();

// ============================================
// Planned workouts and races
// ============================================

const PlannedWorkoutZ = z.object({
  id: z.string().optional().describe('Unique workout identifier'),
  scheduled_for: z.string().optional().describe("Scheduled date/time for the workout. Midnight means the user hasn't specified a time"),
  name: z.string().optional().describe('Workout name'),
  description: z.string().optional().describe('Workout description, possibly including structure'),
  expected_tss: z.number().optional().describe('Expected Training Stress Score'),
  expected_if: z.number().optional().describe('Expected Intensity Factor (IF)'),
  expected_duration: z.string().optional().describe('Expected duration of the workout'),
  sport: z.string().optional().describe('Sport/activity type: Cycling, Running, Swimming, etc.'),
  source: z.string().optional().describe('Calendar source: intervals.icu, trainerroad, or zwift'),
  tags: z.array(z.string()).optional().describe('Tags associated with this workout (e.g., "domestique" for tracking)'),
  external_id: z.string().optional().describe('External ID linking to source (e.g., TrainerRoad UID)'),
}).passthrough();

const RaceZ = z.object({
  scheduled_for: z.string().optional().describe('Scheduled date/time in ISO 8601 format. Midnight means the start has not been set'),
  name: z.string().optional().describe('Name of the race'),
  description: z.string().optional().describe('Description of the race, if available'),
  sport: z.string().optional().describe('Sport of the race'),
}).passthrough();

// ============================================
// Athlete profile and sport settings
// ============================================

// Tool responses already format every unit-bearing field per these
// preferences server-side, so the LLM only needs them for narration consistency
// (e.g., when restating the user's height in a sentence).
const UnitPreferencesZ = z.object({
  system: z.string().optional().describe('Fallback unit system for distance, speed, pace, elevation, and stride'),
  weight: z.string().optional().describe('Preferred weight unit'),
  temperature: z.string().optional().describe('Preferred temperature unit'),
  wind: z.string().optional().describe('Preferred wind speed unit (independent of the system fallback)'),
  precipitation: z.string().optional().describe('Preferred precipitation unit'),
  height: z.string().optional().describe("Preferred unit for the athlete's physical-stature height; not used for elevation or stride"),
}).passthrough();

const SportSettingsZ = z.object({
  types: z.array(z.string()).optional().describe('Activity types this sport setting applies to (e.g., ["Ride", "VirtualRide"])'),
  ftp: z.string().optional().describe('Functional Threshold Power'),
  indoor_ftp: z.string().optional().describe('Indoor-specific FTP (only present if different from outdoor)'),
  sweet_spot_min: z.string().optional().describe('Sweet spot lower bound (relative to FTP)'),
  sweet_spot_max: z.string().optional().describe('Sweet spot upper bound (relative to FTP)'),
  lthr: z.string().optional().describe('Lactate Threshold Heart Rate'),
  max_hr: z.string().optional().describe('Maximum heart rate'),
  hr_zones: z.array(HRZoneZ).optional().describe('Current heart rate zones. Note: may differ from Whoop HR zones (Whoop uses HRR)'),
  threshold_pace: z.string().optional().describe('Threshold pace'),
  power_zones: z.array(PowerZoneZ).optional().describe('Current power zones'),
  indoor_power_zones: z.array(PowerZoneZ).optional().describe('Indoor-specific power zones (only present if indoor_ftp differs from ftp)'),
  pace_zones: z.array(PaceZoneZ).optional().describe('Current pace zones'),
}).passthrough();

// ============================================
// Performance curves
// ============================================

const PowerBestZ = z.object({
  power: z.string().optional().describe('Best power output'),
  power_to_weight: z.string().optional().describe('Power-to-weight ratio'),
  activity_id: z.string().optional().describe('Activity that produced the best'),
  date: z.string().optional().describe('Date of that activity'),
}).passthrough();

const PowerCurveSummaryZ = z.object({
  best_5s: PowerBestZ.nullable().optional().describe('Best 5-second power (neuromuscular/sprint)'),
  best_30s: PowerBestZ.nullable().optional().describe('Best 30-second power (anaerobic capacity)'),
  best_1min: PowerBestZ.nullable().optional().describe('Best 1-minute power (anaerobic endurance)'),
  best_5min: PowerBestZ.nullable().optional().describe('Best 5-minute power (VO2max proxy)'),
  best_20min: PowerBestZ.nullable().optional().describe('Best 20-minute power (FTP proxy)'),
  best_60min: PowerBestZ.nullable().optional().describe('Best 60-minute power (endurance)'),
  best_2hr: PowerBestZ.nullable().optional().describe('Best 2-hour power (long endurance)'),
  estimated_ftp: z.string().nullable().optional().describe('Estimated FTP based on 95% of best 20-minute power'),
}).passthrough();

const PowerCurveComparisonZ = z.object({
  duration_label: z.string().optional(),
  current_power: z.string().optional().describe('Power in current period'),
  previous_power: z.string().optional().describe('Power in previous period'),
  change_power: z.string().optional().describe('Absolute change (current - previous)'),
  change_percent: z.string().optional().describe('Change from previous period'),
  improved: z.boolean().optional().describe('Whether performance improved (true) or declined (false)'),
}).passthrough();

const PaceBestZ = z.object({
  time_seconds: z.number().optional().describe('Best time in seconds'),
  pace: z.string().optional().describe('Pace in human-readable format'),
  activity_id: z.string().optional(),
  date: z.string().optional(),
}).passthrough();

const PaceCurveSummaryZ = z.object({
  best_400m: PaceBestZ.nullable().optional().describe('Best 400m time and pace (sprint/track)'),
  best_1km: PaceBestZ.nullable().optional().describe('Best 1km time and pace (middle distance)'),
  best_mile: PaceBestZ.nullable().optional().describe('Best mile time and pace'),
  best_5km: PaceBestZ.nullable().optional().describe('Best 5km time and pace (aerobic endurance)'),
  best_10km: PaceBestZ.nullable().optional().describe('Best 10km time and pace'),
  best_half_marathon: PaceBestZ.nullable().optional().describe('Best half marathon time and pace (21.1km)'),
  best_marathon: PaceBestZ.nullable().optional().describe('Best marathon time and pace (42.2km)'),
  best_100m: PaceBestZ.nullable().optional().describe('Best 100m time and pace (sprint)'),
  best_200m: PaceBestZ.nullable().optional().describe('Best 200m time and pace'),
  best_800m: PaceBestZ.nullable().optional().describe('Best 800m time and pace'),
  best_1500m: PaceBestZ.nullable().optional().describe('Best 1500m time and pace (Olympic distance)'),
  best_half_iron_swim: PaceBestZ.nullable().optional().describe('Best Half Ironman swim time and pace (1.9km)'),
  best_iron_swim: PaceBestZ.nullable().optional().describe('Best Ironman swim time and pace (3.8km)'),
}).passthrough();

const PaceCurveComparisonZ = z.object({
  distance_label: z.string().optional(),
  current_time_seconds: z.number().optional().describe('Time in current period'),
  previous_time_seconds: z.number().optional().describe('Time in previous period'),
  change_seconds: z.number().optional().describe('Absolute change in seconds (negative = faster)'),
  change_percent: z.string().optional().describe('Change from previous period (negative = faster)'),
  improved: z.boolean().optional().describe('Whether performance improved (true = faster)'),
}).passthrough();

const HRBestZ = z.object({
  hr: z.string().optional().describe('Maximum sustained heart rate'),
  activity_id: z.string().optional(),
  date: z.string().optional(),
}).passthrough();

const HRCurveSummaryZ = z.object({
  max_1s: HRBestZ.nullable().optional().describe('Maximum 1-second HR (peak HR)'),
  max_5s: HRBestZ.nullable().optional().describe('Maximum 5-second sustained HR'),
  max_30s: HRBestZ.nullable().optional(),
  max_1min: HRBestZ.nullable().optional().describe('Maximum 1-minute sustained HR'),
  max_5min: HRBestZ.nullable().optional().describe('Maximum 5-minute sustained HR'),
  max_20min: HRBestZ.nullable().optional().describe('Maximum 20-minute sustained HR (threshold proxy)'),
  max_60min: HRBestZ.nullable().optional(),
  max_2hr: HRBestZ.nullable().optional().describe('Maximum 2-hour sustained HR (endurance)'),
}).passthrough();

const HRCurveComparisonZ = z.object({
  duration_label: z.string().optional(),
  current_hr: z.string().optional().describe('HR in current period'),
  previous_hr: z.string().optional().describe('HR in previous period'),
  change_hr: z.string().optional().describe('Absolute change (current - previous)'),
  change_percent: z.string().optional().describe('Change from previous period'),
}).passthrough();

// ============================================
// Activity totals
// ============================================

const ZoneTotalEntryZ = z.object({
  name: z.string().optional().describe('Zone name (e.g., "Recovery", "Endurance", "Tempo")'),
  time: z.string().optional().describe('Total time spent in this zone'),
  percentage: z.string().optional().describe('Share of total time in this zone'),
}).passthrough();

const SportTotalsZ = z.object({
  activities: z.number().optional().describe('Number of activities for this sport'),
  duration: z.string().optional().describe('Total duration for this sport'),
  distance: z.string().optional().describe('Total distance for this sport'),
  climbing: z.string().optional().describe('Total climbing for this sport (only present if > 0)'),
  load: z.number().optional().describe('Total training load for this sport'),
  kcal: z.number().optional().describe('Calories burned for this sport'),
  work: z.string().optional().describe('Work done for this sport (only present if > 0)'),
  coasting: z.string().optional().describe('Total coasting time for this sport (cycling only)'),
  zones: z.object({
    power: z.array(ZoneTotalEntryZ).optional().describe('Power zone distribution (if available for this sport)'),
    pace: z.array(ZoneTotalEntryZ).optional().describe('Pace zone distribution (if available for this sport)'),
    heart_rate: z.array(ZoneTotalEntryZ).optional().describe('Heart rate zone distribution'),
  }).passthrough().optional(),
}).passthrough();

// ============================================
// Weather forecast (Google Weather API)
// ============================================

const AirQualityZ = z.object({
  aqi: z.number().describe('Numeric AQI value on the local scale'),
  category: z.string().optional().describe('Category label for the AQI band (e.g., "Good air quality", "Moderate air quality")'),
  dominant_pollutant: z.string().optional().describe('Lower-case pollutant code that drives the AQI value (e.g., "pm25", "o3", "no2")'),
  index_display_name: z.string().optional().describe('Human-readable name for the AQI scale (e.g., "AQI (US)")'),
}).passthrough();

const PollenIndexLevelZ = z.object({
  value: z.number().describe('Numeric Universal Pollen Index value (typically 1–5; higher = more pollen)'),
  category: z.string().optional().describe('Category band for the UPI value (e.g., "Very low", "Low", "Moderate", "High", "Very high")'),
  description: z.string().optional().describe('One-line description of what this UPI value means for sensitive people'),
  pollen_types: z.array(z.string()).optional().describe('Pollen-type display names at this UPI level (e.g., "Grass", "Tree", "Weed")'),
  plants: z.array(z.string()).optional().describe('Plant display names at this UPI level (e.g., "Birch", "Oak", "Ragweed")'),
}).passthrough();

const PollenZ = z.object({
  date: z.string().describe("Date the pollen forecast applies to, in YYYY-MM-DD format in the athlete's timezone"),
  universal_pollen_index: z.array(PollenIndexLevelZ).describe('Pollen activity grouped by UPI value, sorted by value descending (worst conditions first). Only levels with at least one entry are present'),
}).passthrough();

const CurrentWeatherZ = z.object({
  as_of: z.string().optional().describe('Timestamp the conditions were measured/modeled at'),
  condition: z.string().optional().describe('Human-readable description of the dominant condition (e.g., "Sunny", "Mostly cloudy", "Light rain")'),
  daylight: z.boolean().optional().describe('Whether the location is currently in daylight'),
  cloud_cover: z.string().optional().describe('Fraction of sky covered by clouds'),
  humidity: z.string().optional().describe('Relative humidity'),
  temperature: z.string().optional().describe('Air temperature'),
  temperature_apparent: z.string().optional().describe('Feels-like temperature accounting for wind chill / heat index'),
  temperature_dew_point: z.string().optional().describe('Dew point temperature'),
  temperature_heat_index: z.string().optional().describe('Heat index temperature'),
  temperature_wind_chill: z.string().optional().describe('Wind chill temperature'),
  pressure: z.string().optional().describe('Sea-level air pressure'),
  precipitation_amount: z.string().optional().describe('Recent precipitation total'),
  precipitation_chance: z.string().optional().describe('Probability of precipitation'),
  precipitation_type: z.string().optional().describe('Expected precipitation type (e.g., "Rain", "Snow", "Rain and snow")'),
  thunderstorm_probability: z.string().optional().describe('Probability of thunderstorm activity'),
  uv_index: z.number().optional().describe('UV index (unitless 0–11+ scale)'),
  visibility: z.string().optional().describe('Horizontal visibility'),
  wind_direction: z.string().optional().describe('Direction the wind is blowing from'),
  wind_speed: z.string().optional().describe('Sustained wind speed'),
  wind_gust: z.string().optional().describe('Peak wind gust speed'),
  air_quality: AirQualityZ.optional().describe('Local air quality index'),
}).passthrough();

const HourlyForecastZ = z.object({
  forecast_start: z.string().optional().describe('Start of the hourly window'),
  forecast_end: z.string().optional().describe('End of the hourly window'),
  condition: z.string().optional().describe('Human-readable description of the dominant condition for the hour'),
  daylight: z.boolean().optional().describe('Whether this hour falls in daylight'),
  cloud_cover: z.string().optional().describe('Cloud cover fraction'),
  humidity: z.string().optional().describe('Relative humidity'),
  precipitation_amount: z.string().optional().describe('Expected precipitation total for the hour'),
  precipitation_chance: z.string().optional().describe('Probability of any precipitation'),
  precipitation_type: z.string().optional().describe('Expected precipitation type (e.g., "Rain", "Snow", "Rain and snow")'),
  thunderstorm_probability: z.string().optional().describe('Probability of thunderstorm activity'),
  pressure: z.string().optional().describe('Sea-level air pressure'),
  temperature: z.string().optional().describe('Air temperature'),
  temperature_apparent: z.string().optional().describe('Feels-like temperature'),
  temperature_dew_point: z.string().optional().describe('Dew point temperature'),
  temperature_heat_index: z.string().optional().describe('Heat index temperature'),
  temperature_wind_chill: z.string().optional().describe('Wind chill temperature'),
  temperature_wet_bulb: z.string().optional().describe('Wet bulb temperature, the temperature a parcel of air would reach if cooled to saturation by evaporation. A standard heat-stress indicator for endurance athletes; elevated values indicate serious heat-stress risk'),
  uv_index: z.number().optional().describe('UV index'),
  visibility: z.string().optional().describe('Horizontal visibility'),
  wind_direction: z.string().optional().describe('Direction the wind is blowing from'),
  wind_speed: z.string().optional().describe('Sustained wind speed'),
  wind_gust: z.string().optional().describe('Peak wind gust speed'),
  air_quality: AirQualityZ.optional().describe('Local air quality index for this hour'),
}).passthrough();

const WeatherAlertZ = z.object({
  title: z.string().optional().describe('Short, human-readable alert headline (e.g., "Flash Flood Warning")'),
  description: z.string().optional().describe('Full description of the alert with hazards, impacts, and instructions'),
  event_type: z.string().optional().describe('Category of weather event (e.g., "Tornado", "Flood", "Heat", "Wildfire")'),
  area_name: z.string().optional().describe('Geographic area the alert applies to'),
  severity: z.string().optional().describe('Threat level of the alert (e.g., "Extreme", "Severe", "Moderate", "Minor")'),
  urgency: z.string().optional().describe('How quickly action should be taken (e.g., "Immediate", "Expected", "Future")'),
  certainty: z.string().optional().describe('Confidence that the event will occur (e.g., "Observed", "Likely", "Possible")'),
  start_time: z.string().optional().describe('When the alert goes into effect'),
  expiration_time: z.string().optional().describe('When the alert expires'),
  source: z.string().optional().describe('Issuing organization (e.g., "National Weather Service")'),
}).passthrough();

const SunEventsZ = z.object({
  sunrise: z.string().optional().describe("Sunrise time at the location on the forecast date in the location's timezone. May be absent in polar regions when the sun does not rise during the local day"),
  sunset: z.string().optional().describe("Sunset time at the location on the forecast date in the location's timezone. May be absent in polar regions when the sun does not set during the local day"),
}).passthrough();

const MoonEventsZ = z.object({
  moon_phase: z.string().optional().describe('Lunar phase on the forecast date (e.g., "New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent")'),
  moonrise: z.string().optional().describe("Moonrise time at the location on the forecast date in the location's timezone. Absent when the moon does not rise during the local day"),
  moonset: z.string().optional().describe("Moonset time at the location on the forecast date in the location's timezone. Absent when the moon does not set during the local day"),
}).passthrough();

const DailySummaryZ = z.object({
  condition: z.string().optional().describe('Human-readable description of the dominant daytime condition (e.g., "Sunny", "Mostly cloudy", "Light rain")'),
  temperature_max: z.string().optional().describe('Maximum air temperature for the day'),
  temperature_min: z.string().optional().describe('Minimum air temperature for the day'),
  temperature_max_apparent: z.string().optional().describe('Maximum feels-like temperature for the day'),
  temperature_min_apparent: z.string().optional().describe('Minimum feels-like temperature for the day'),
  temperature_heat_index_max: z.string().optional().describe('Peak heat-index temperature reached during the day'),
  cloud_cover: z.string().optional().describe('Daytime cloud cover fraction'),
  humidity: z.string().optional().describe('Daytime relative humidity'),
  precipitation_amount: z.string().optional().describe('Expected daytime precipitation total'),
  precipitation_chance: z.string().optional().describe('Daytime probability of any precipitation'),
  precipitation_type: z.string().optional().describe('Expected daytime precipitation type (e.g., "Rain", "Snow", "Rain and snow")'),
  thunderstorm_probability: z.string().optional().describe('Daytime probability of thunderstorm activity'),
  uv_index: z.number().optional().describe('Daytime UV index'),
  wind_direction: z.string().optional().describe('Daytime direction the wind is blowing from'),
  wind_speed: z.string().optional().describe('Daytime sustained wind speed'),
  wind_gust: z.string().optional().describe('Daytime peak wind gust speed'),
  sun_events: SunEventsZ.optional().describe('Sunrise and sunset times at the location on the forecast date'),
  moon_events: MoonEventsZ.optional().describe('Lunar phase and moonrise/moonset times at the location on the forecast date'),
}).passthrough();

const LocationForecastZ = z.object({
  location: z.string().optional().describe("Human-readable label for this location. For configured weather locations this is the user's label (e.g., \"Home\", \"Moose\"); for free-text place queries this is the resolved formatted address"),
  latitude: z.number().optional().describe('Location latitude'),
  longitude: z.number().optional().describe('Location longitude'),
  elevation: z.string().optional().describe('Elevation at the location'),
  forecast_date: z.string().optional().describe("The date this forecast is for (YYYY-MM-DD) in the location's timezone"),
  current_conditions: CurrentWeatherZ.nullable().optional().describe('Current conditions at the location. Only present when the forecast date is today; null if no current data is available'),
  daily_summary: DailySummaryZ.optional().describe('Daily forecast summary for the date (high/low temps, conditions, precipitation, wind)'),
  hourly_forecast: z.array(HourlyForecastZ).optional().describe("Hourly forecast for the forecast date in the location's timezone — remaining hours of the day when the date is today, all 24 hours otherwise"),
  alerts: z.array(WeatherAlertZ).optional().describe('Active weather alerts whose effective window overlaps the forecast date, sorted with the most severe first'),
  pollen: PollenZ.optional().describe('Pollen forecast for the location on the forecast date. May be absent for dates further out — pollen has a shorter forecast window than the daily/hourly weather'),
}).passthrough();

// ============================================
// Tool output schemas (the raw shapes consumed by registerTool)
// ============================================

export const athleteProfileOutputSchema = {
  id: z.string().optional().describe('Unique ID of the athlete in Intervals.icu'),
  name: z.string().optional().describe("Athlete's name"),
  city: z.string().optional().describe('City of residence'),
  state: z.string().optional().describe('State/province of residence'),
  country: z.string().optional().describe('Country of residence'),
  timezone: z.string().optional().describe("Athlete's timezone"),
  sex: z.string().optional().describe("Athlete's gender"),
  date_of_birth: z.string().optional().describe('Date of birth in ISO 8601 format. Only present if set in Intervals.icu'),
  age: z.number().optional().describe('Current age in years. Only present if date_of_birth is set'),
  unit_preferences: UnitPreferencesZ.optional().describe("Athlete's preferred units, sourced from Intervals.icu. Tool responses are already formatted in these units; use them for narrative consistency when restating values"),
} as const;

const PerSportSettingsZ = z.object({
  types: z.array(z.string()).optional().describe('Activity types this sport setting applies to (e.g., ["Ride", "VirtualRide"])'),
  settings: SportSettingsZ.optional().describe('Sport-specific settings (FTP, zones, thresholds)'),
}).passthrough();

export const sportSettingsOutputSchema = {
  cycling: PerSportSettingsZ.nullable().optional().describe('Cycling settings. Present when "cycling" was requested (or when no sports filter was supplied); null if the athlete has no cycling settings configured'),
  running: PerSportSettingsZ.nullable().optional().describe('Running settings. Present when "running" was requested (or when no sports filter was supplied); null if the athlete has no running settings configured'),
  swimming: PerSportSettingsZ.nullable().optional().describe('Swimming settings. Present when "swimming" was requested (or when no sports filter was supplied); null if the athlete has no swimming settings configured'),
} as const;

export const strainHistoryOutputSchema = {
  strain: z.array(StrainDataZ).describe('Whoop strain data for the requested date range, including activities logged in the Whoop app'),
} as const;

export const workoutHistoryOutputSchema = {
  workouts: z.array(WorkoutSummaryZ).describe('Completed workouts and fitness activities in the date range, with comprehensive metrics and matched Whoop strain data when available. Use get_workout_details for full per-activity detail (intervals, notes, weather, music)'),
  hints: hintsField,
} as const;

export const recoveryTrendsOutputSchema = {
  data: z.array(WhoopRecoveryTrendEntryZ).describe('Daily recovery and sleep entries for the requested range'),
  summary: z.object({
    avg_recovery: z.string().optional().describe('Average recovery score over the period'),
    avg_hrv: z.string().optional().describe('Average HRV over the period'),
    avg_sleep: z.string().optional().describe('Average time in bed per day'),
    min_recovery: z.string().optional().describe('Lowest recovery score in the period'),
    max_recovery: z.string().optional().describe('Highest recovery score in the period'),
  }).passthrough().describe('Aggregate recovery statistics over the period'),
} as const;

export const wellnessTrendsOutputSchema = {
  period_days: z.number().optional().describe('Number of days in the wellness data period'),
  start_date: z.string().optional().describe('Start date of wellness data period (ISO 8601)'),
  end_date: z.string().optional().describe('End date of wellness data period (ISO 8601)'),
  data: z.array(DailyWellnessZ).describe('Daily wellness entries, sorted oldest to newest'),
} as const;

export const activityTotalsOutputSchema = {
  period: z.object({
    start_date: z.string().optional().describe('Start date of the period (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date of the period (YYYY-MM-DD)'),
    weeks: z.number().optional().describe('Number of weeks in the period'),
    days: z.number().optional().describe('Total days in the period'),
    active_days: z.number().optional().describe('Days with at least one activity'),
  }).passthrough().describe('Time period analyzed'),
  totals: z.object({
    activities: z.number().optional().describe('Total number of activities'),
    duration: z.string().optional().describe('Total moving time across all activities'),
    distance: z.string().optional().describe('Total distance covered'),
    climbing: z.string().optional().describe('Total elevation gain (only present if > 0)'),
    load: z.number().optional().describe('Total training load (TSS)'),
    kcal: z.number().optional().describe('Total calories burned'),
    work: z.string().optional().describe('Total work done (only present if > 0)'),
    coasting: z.string().optional().describe('Total coasting/recovery time'),
  }).passthrough().describe('Aggregated totals across all activities. Zone breakdowns are per-sport in by_sport[*].zones, since zones differ by sport'),
  by_sport: z.record(z.string(), SportTotalsZ).describe('Breakdown by sport type. Keys are sport names (cycling, running, swimming, etc.)'),
} as const;

export const upcomingWorkoutsOutputSchema = {
  workouts: z.array(PlannedWorkoutZ).describe('Planned workouts and fitness activities for the requested future range, from both TrainerRoad and Intervals.icu'),
  hints: hintsField,
} as const;

export const upcomingRacesOutputSchema = {
  races: z.array(RaceZ).describe('Upcoming races from the TrainerRoad calendar'),
} as const;

export const workoutDetailsOutputSchema = {
  workout: WorkoutDetailZ.describe('Detailed workout including intervals, notes, weather, zones, heat zones, music, and matched Whoop strain data'),
} as const;

export const trainingLoadTrendsOutputSchema = {
  period_days: z.number().optional().describe('Number of days analyzed'),
  sport: z.string().optional().describe('Sport scope of the analysis'),
  data: z.array(DailyTrainingLoadZ).describe('Daily training load metrics, sorted oldest to newest'),
  summary: TrainingLoadSummaryZ.describe('Summary of training load over the period including current values, trends, peak, and ACWR'),
} as const;

export const powerCurveOutputSchema = {
  period_start: z.string().optional().describe('Start date of analysis period (ISO 8601)'),
  period_end: z.string().optional().describe('End date of analysis period (ISO 8601)'),
  sport: z.string().optional().describe('Sport type analyzed (cycling)'),
  activity_count: z.number().optional().describe('Number of activities analyzed'),
  durations_analyzed: z.array(z.string()).optional().describe('Human-readable list of durations analyzed (e.g., ["5s", "1min", "5min", "20min"])'),
  summary: PowerCurveSummaryZ.optional().describe('Best power output at key durations'),
  comparison: z.object({
    previous_period_start: z.string().optional().describe('Start date of comparison period'),
    previous_period_end: z.string().optional().describe('End date of comparison period'),
    previous_activity_count: z.number().optional().describe('Number of activities in comparison period'),
    changes: z.array(PowerCurveComparisonZ).optional().describe('Changes at each duration between periods'),
  }).passthrough().nullable().describe('Comparison data vs a previous period. Null when compare_to_* params were not supplied'),
  hints: hintsField,
} as const;

export const paceCurveOutputSchema = {
  period_start: z.string().optional().describe('Start date of analysis period (ISO 8601)'),
  period_end: z.string().optional().describe('End date of analysis period (ISO 8601)'),
  sport: z.string().optional().describe('Sport type analyzed (running or swimming)'),
  gap_adjusted: z.boolean().optional().describe('Whether pace is gradient-adjusted (running only)'),
  activity_count: z.number().optional().describe('Number of activities analyzed'),
  distances_analyzed: z.array(z.string()).optional().describe('Human-readable list of distances analyzed (e.g., ["400m", "1km", "5km"])'),
  summary: PaceCurveSummaryZ.optional().describe('Best times at key distances'),
  comparison: z.object({
    previous_period_start: z.string().optional(),
    previous_period_end: z.string().optional(),
    previous_activity_count: z.number().optional(),
    changes: z.array(PaceCurveComparisonZ).optional(),
  }).passthrough().nullable().describe('Comparison data vs a previous period. Null when compare_to_* params were not supplied'),
  hints: hintsField,
} as const;

export const hrCurveOutputSchema = {
  period_start: z.string().optional().describe('Start date of analysis period (ISO 8601)'),
  period_end: z.string().optional().describe('End date of analysis period (ISO 8601)'),
  sport: z.string().nullable().optional().describe('Sport type analyzed (or null for all sports)'),
  activity_count: z.number().optional().describe('Number of activities analyzed'),
  durations_analyzed: z.array(z.string()).optional().describe('Human-readable list of durations analyzed'),
  summary: HRCurveSummaryZ.optional().describe('Maximum sustained HR at key durations'),
  comparison: z.object({
    previous_period_start: z.string().optional(),
    previous_period_end: z.string().optional(),
    previous_activity_count: z.number().optional(),
    changes: z.array(HRCurveComparisonZ).optional(),
  }).passthrough().nullable().describe('Comparison data vs a previous period. Null when compare_to_* params were not supplied'),
} as const;

// ============================================
// Today's data + daily summary
// ============================================

export const todaysSummaryOutputSchema = {
  current_time: z.string().optional().describe("Current date and time in the user's local timezone. Use this to understand time of day when interpreting metrics"),
  whoop: z.object({
    body_measurements: WhoopBodyMeasurementsZ.nullable().optional().describe('Body measurements from Whoop. Null if unavailable'),
    strain: StrainDataZ.nullable().optional().describe("Today's Whoop strain data. Null if unavailable"),
    sleep: WhoopSleepZ.nullable().optional().describe("Today's Whoop sleep data. Null if unavailable"),
    recovery: WhoopRecoveryZ.nullable().optional().describe("Today's Whoop recovery data. Null if unavailable"),
  }).passthrough().optional().describe("Today's Whoop data"),
  fitness: FitnessMetricsZ.nullable().optional().describe("Today's fitness metrics (CTL/ATL/TSB) from Intervals.icu. Null if unavailable"),
  wellness: WellnessDataZ.nullable().optional().describe("Today's wellness data from Intervals.icu — HRV, resting HR, sleep, SpO2, blood pressure, body composition, subjective scores, nutrition, and more. Includes a `sources` map naming each field's configured provider (garmin/whoop/oura). Some fields overlap with whoop.* and are shown in parallel intentionally so the same metric can be reconciled across sources. Null if no wellness data was recorded."),
  planned_workouts: z.array(PlannedWorkoutZ).optional().describe('Workouts planned for today from TrainerRoad and Intervals.icu'),
  completed_workouts: z.array(WorkoutSummaryZ).optional().describe('Workouts completed so far today, with matched Whoop data. Use get_todays_workouts for full per-activity detail (intervals, notes, weather, music)'),
  scheduled_race: RaceZ.nullable().optional().describe("Today's race, if any"),
  forecast: z.array(LocationForecastZ).optional().describe("Today's weather forecast for each of the user's configured weather locations. Empty when no weather provider is configured or no locations are configured"),
  workouts_planned: z.number().optional().describe('Number of workouts planned for today'),
  workouts_completed: z.number().optional().describe('Number of workouts completed today'),
  tss_planned: z.number().optional().describe('Total expected TSS from planned workouts'),
  tss_completed: z.number().optional().describe('Total TSS from completed workouts'),
  hints: hintsField,
} as const;

export const forecastInputSchema = {
  date: z.string().optional().describe("Date the forecast is for, accepting ISO YYYY-MM-DD or natural language (e.g., \"tomorrow\", \"in 3 days\"). Defaults to today. Must be within today through 10 days from today"),
  location: z.string().optional().describe("Free-text place query: a city, postal code, neighborhood, landmark, venue, or street address. Prefer the most specific form available so the forecast reflects the spot's microclimate (e.g., narrow to the race start when known). When omitted, returns forecasts for the user's configured weather locations. The resolved place name is surfaced in the response"),
} as const;

export const forecastOutputSchema = {
  current_time: z.string().optional().describe("Current date and time in the user's local timezone"),
  forecasts: z.array(LocationForecastZ).describe("Per-location forecasts for the requested date. One entry per resolved location: the user's configured weather locations when `location` is omitted, a single entry when `location` is provided"),
} as const;

export const todaysWorkoutsOutputSchema = {
  current_time: z.string().optional().describe("Current date and time in the user's local timezone"),
  completed_workouts: z.array(WorkoutDetailZ).describe('Workouts completed so far today, with full per-activity details (intervals, notes, weather, zones, heat zones, music) and matched Whoop strain data'),
  planned_workouts: z.array(PlannedWorkoutZ).describe('Workouts planned for today from TrainerRoad and Intervals.icu'),
  workouts_completed: z.number().optional().describe('Number of workouts completed today'),
  workouts_planned: z.number().optional().describe('Number of workouts planned for today'),
  tss_completed: z.number().optional().describe('Total TSS from completed workouts'),
  tss_planned: z.number().optional().describe('Total expected TSS from planned workouts'),
  hints: hintsField,
} as const;

// ============================================
// Workout management responses
// ============================================

export const createWorkoutOutputSchema = {
  id: z.number().optional().describe('Intervals.icu event ID'),
  uid: z.string().optional().describe('Intervals.icu event UID'),
  name: z.string().optional().describe('Name of the created workout'),
  scheduled_for: z.string().optional().describe('Scheduled date/time'),
  intervals_icu_url: z.string().optional().describe('URL to view the workout in Intervals.icu'),
} as const;

export const deleteWorkoutOutputSchema = {
  deleted: z.boolean().optional().describe('Whether the workout was deleted'),
  message: z.string().optional().describe('Human-readable result message'),
} as const;

export const updateWorkoutOutputSchema = {
  id: z.number().optional().describe('Intervals.icu event ID'),
  uid: z.string().optional().describe('Intervals.icu event UID'),
  name: z.string().optional().describe('Name of the updated workout'),
  scheduled_for: z.string().optional().describe('Scheduled date/time'),
  intervals_icu_url: z.string().optional().describe('URL to view the workout in Intervals.icu'),
  updated_fields: z.array(z.string()).optional().describe('Fields that were updated'),
} as const;

export const syncTrainerRoadRunsOutputSchema = {
  tr_runs_found: z.number().optional().describe('Number of TR runs found that need syncing'),
  orphans_deleted: z.number().optional().describe('Number of orphaned workouts deleted'),
  runs_to_sync: z.array(z.object({
    tr_uid: z.string().optional().describe('TrainerRoad workout UID'),
    tr_name: z.string().optional().describe('TrainerRoad workout name'),
    tr_description: z.string().optional().describe('TrainerRoad workout description'),
    scheduled_for: z.string().optional().describe('Scheduled date/time'),
    expected_tss: z.number().optional().describe('Expected TSS'),
    expected_duration: z.string().optional().describe('Expected duration'),
  }).passthrough()).describe('TR runs that need to be created in Intervals.icu via create_workout with sport "running"'),
  runs_to_update: z.array(z.object({
    tr_uid: z.string().optional(),
    tr_name: z.string().optional(),
    tr_description: z.string().optional(),
    scheduled_for: z.string().optional(),
    expected_tss: z.number().optional(),
    expected_duration: z.string().optional(),
    icu_event_id: z.string().optional().describe('Intervals.icu event ID of the existing workout to update'),
    icu_name: z.string().optional().describe('Current name of the ICU workout'),
    changes: z.array(z.string()).optional().describe('List of changed fields (e.g., ["name", "date", "description"])'),
  }).passthrough()).describe('TR runs that need to be updated via update_workout'),
  deleted: z.array(z.object({
    name: z.string().optional(),
    reason: z.string().optional(),
  }).passthrough()).describe('Details of deleted orphans'),
  updated: z.array(z.object({
    name: z.string().optional(),
    changes: z.array(z.string()).optional(),
  }).passthrough()).describe('Details of updated workouts'),
  errors: z.array(z.string()).describe('Any errors encountered during sync'),
} as const;

export const setWorkoutIntervalsOutputSchema = {
  activity_id: z.string().optional().describe('Intervals.icu activity ID that was updated'),
  intervals_set: z.number().optional().describe('Number of intervals set on the activity'),
  intervals_icu_url: z.string().optional().describe('URL to view the activity in Intervals.icu'),
} as const;

export const updateActivityOutputSchema = {
  activity_id: z.string().optional().describe('Intervals.icu activity ID'),
  updated_fields: z.array(z.string()).optional().describe('List of fields that were updated'),
  intervals_icu_url: z.string().optional().describe('URL to view the activity in Intervals.icu'),
} as const;
