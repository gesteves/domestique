/**
 * Field descriptions for MCP tool responses.
 * These are included in responses so the LLM knows what each field means and its units.
 */

export const WORKOUT_FIELD_DESCRIPTIONS = {
  // Core fields
  id: 'Unique ID of the completed activity in Intervals.icu',
  start_time: 'Activity start time in the user\'s local timezone',
  activity_type: 'Sport or discipline of the activity',
  name: 'Name of the activity',
  description: 'Description of the activity',
  duration: 'Total duration of the activity',
  distance: 'Total distance of the activity',
  source: 'Source of the data for this activity',

  // Activity URLs
  intervals_icu_url: 'URL to view this activity on Intervals.icu',
  garmin_connect_url: 'URL to view this activity on Garmin Connect',
  zwift_url: 'URL to view this activity on Zwift',
  strava_url: 'URL to view this activity on Strava',

  // Training load
  tss: 'Training Stress Score (TSS)',
  load: 'Training load (equivalent to TSS for power-based activities)',
  intensity_factor: 'Intensity Factor (IF), a measure of how hard it was compared to your FTP',
  trimp: 'Training Impulse, a measure of training load derived from the average HR for the activity relative to resting HR and max HR and the moving time',
  session_rpe: 'Session RPE = RPE × duration in minutes, a method of quantifying training load by considering the intensity (RPE) and duration of the training session (or competition)',
  icu_strain_score: 'Intervals.icu strain score, similar to XSS in Xert, a power based training load metric that considers time spent above the maximal metabolic steady state to estimate the level of strain for the activity. Unrelated to Whoop\'s strain score.',

  // Power metrics
  normalized_power: 'Normalized Power (NP) in watts',
  average_power: 'Average power in watts',
  ftp: 'FTP used for this activity, in watts; set by the user',
  eftp: 'FTP estimated by Intervals.icu for the user, in watts',
  activity_eftp: 'FTP estimated by Intervals.icu from this activity on its own, in watts',
  w_prime: "W' (W prime), anaerobic work capacity in joules, the amount of energy in Joules you have available when riding above threshold",
  pmax: 'Highest instant power that can be produced for a very short duration',
  work_kj: 'Total work done, in kilojoules',
  lthr: 'Lactate Threshold Heart Rate at time of activity, in beats per minute',

  // Heart rate
  average_heart_rate: 'Average heart rate in beats per minute',
  max_heart_rate: 'Maximum heart rate in beats per minute',
  hrrc: 'Heart rate recovery, the largest drop in HR over 60 seconds starting from a HR of at least threshold',

  // Speed
  average_speed: 'Average speed during the activity',
  max_speed: 'Maximum speed during the activity',

  // Cadence
  average_cadence: 'Average cadence in RPM (cycling) or steps/min (running)',
  max_cadence: 'Maximum cadence in RPM or steps/min',

  // Efficiency
  variability_index: 'Variability Index (VI)',
  power_hr_ratio: 'Power:HR ratio, a measure of how much output (watts) you produce for a given input (heart rate measured in beats/minute)',
  efficiency_factor: 'Efficiency Factor (EF), normalized watts (output) divided by average heart rate (input)',

  // Coasting
  coasting_time: 'Total time spent coasting',
  coasting_percentage: 'Percentage of ride time spent coasting',

  // Subjective
  rpe: 'Rate of Perceived Exertion (1-10 scale, 1 = Nothing at all, 2 = Very easy, 3 = Easy, 4 = Comfortable, 5 = Slightly challenging, 6 = Difficult, 7 = Hard, 8 = Very hard, 9 = Extremely hard, 10 = Max effort)',
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

  // Energy
  calories: 'Estimated calories burned',
  cho_used_g: 'Estimated carbohydrates used, in grams',
  cho_intake_g: 'Carbohydrates consumed during activity, in grams. Seldom used, its absence doesn\'t imply lack of consumption.',

  // Athlete metrics at time of activity
  weight: 'Athlete weight at time of activity',
  resting_hr: 'Resting heart rate at time of activity, in beats per minute',

  // Running specific
  average_stride_m: 'Average stride length in meters',
  gap: 'Gradient Adjusted Pace',

  // Swimming specific
  pool_length: 'Length of the pool in meters',
  lengths: 'Number of pool lengths swum',

  // Activity context
  is_indoor: 'Whether activity was indoor',
  is_commute: 'Whether activity was marked as a commute',
  is_race: 'Whether activity was marked as a race',

  // Zone data (normalized with names, thresholds, and time in zones)
  hr_zones: 'Array of heart rate zone objects. Each object contains: name (e.g., "Z1", "Z2"), low_bpm, high_bpm (null for highest zone), and time_in_zone (human-readable duration like "1:49:44"). These zones are from the time of the activity and may differ from current athlete profile zones.',
  power_zones: 'Array of power zone objects. Each object contains: name (e.g., "Active Recovery", "Endurance"), low_percent, high_percent (null for highest zone), low_watts, high_watts (null for highest zone), and time_in_zone (human-readable duration). Zones are from the time of the activity and may differ from current athlete profile zones.',
  pace_zones: 'Array of pace zone objects. Each object contains: name (e.g., "Easy", "Tempo"), low_percent, high_percent (null for highest zone), slow_pace (slower pace at low %), fast_pace (faster pace at high %), and time_in_zone (human-readable duration). Zones are from the time of the activity and may differ from current athlete profile zones.',

  // Heat training data
  heat_zones: 'Array of heat zone objects. Each object contains: name (e.g., "Zone 1: No Heat Strain", "Zone 2: Moderate Heat Strain"), low_heat_strain_index, high_heat_strain_index (null for highest zone), and time_in_zone (human-readable duration). Heat zones are based on the Heat Strain Index (HSI) and are only present if heat strain data from a CORE body temperature sensor is available for the activity.',

  max_heat_strain_index: 'Maximum Heat Strain Index (HSI) reached during the activity, recorded by a CORE body temperature sensor.',
  median_heat_strain_index: 'Median Heat Strain Index (HSI) throughout the activity, recorded by a CORE body temperature sensor.',
  heat_training_load: 'Heat Training Load (HTL) score from 0-10, measuring the contribution of this activity to heat adaptation. Note: This is an approximation based on CORE\'s published documentation; the exact proprietary formula is not publicly available.',

  // Ambient temperature data
  min_ambient_temperature: 'Minimum ambient temperature (water temperature for swimming, air temperature for other activities) during the activity in Celsius, recorded by the user\'s watch or bike computer.',
  max_ambient_temperature: 'Maximum ambient temperature (water temperature for swimming, air temperature for other activities) during the activity in Celsius, recorded by the user\'s watch or bike computer.',
  median_ambient_temperature: 'Median ambient temperature (water temperature for swimming, air temperature for other activities) during the activity in Celsius, recorded by the user\'s watch or bike computer. Use this when reporting water temperature for swimming activities.',
  start_ambient_temperature: 'Ambient temperature (water temperature for swimming, air temperature for other activities) at the start of the activity in Celsius, recorded by the user\'s watch or bike computer.',
  end_ambient_temperature: 'Ambient temperature (water temperature for swimming, air temperature for other activities) at the end of the activity in Celsius, recorded by the user\'s watch or bike computer.',

  // Notes
  notes: 'Array of notes/messages left by the athlete or other Intervals.icu users (like a coach) for this activity. Each note contains: the author, created date, type, content (the note text), and optional attachment_url and attachment_mime_type.',
};

export const WHOOP_FIELD_DESCRIPTIONS = {
  // Strain activity
  strain_score: 'Whoop metric of the cardiovascular load, the level of strain the workout had on the user\'s cardiovascular system based on the user\'s heart rate. Strain is scored on a logarithmic scale from 0 to 21. Light: 0-9, Moderate: 10-13, High: 14-17, All out: 18-21',
  average_heart_rate: 'The user\'s average heart rate (beats per minute) during the workout.',
  max_heart_rate: 'The user\'s max heart rate (beats per minute) during the workout.',
  calories: 'Estimated calories burned by the user',
  duration: 'Duration of the activity',
  distance: 'The distance the user traveled during the workout; only present if distance data sent to Whoop',
  elevation_gain: 'The altitude gained during the workout; this measurement does not account for downward travel - it is strictly a measure of altitude climbed',
  zone_durations: 'Time spent in each Whoop HR zone. Note: Whoop uses the Heart Rate Reserve (HRR) method to calculate these zones; they may not match Intervals.icu HR zones.',
  strain_level: 'Whoop\'s label for the Strain score: Light, Moderate, High, All out',
  strain_level_description: 'Whoop\'s official description for the strain level',
};

export const BODY_MEASUREMENTS_FIELD_DESCRIPTIONS = {
  height_meter: 'The user\'s height in meters',
  weight_kilogram: 'The user\'s weight in kilograms',
  max_heart_rate: 'The user\'s maximum heart rate in BPM calculated by Whoop',
};

export const SLEEP_FIELD_DESCRIPTIONS = {
  // Sleep summary (nested object)
  sleep_summary: 'Summary of the user\'s sleep stages',
  total_in_bed_time: 'Total time the user spent in bed',
  total_awake_time: 'Total time the user spent awake during the sleep period',
  total_no_data_time: 'Total time Whoop didn\'t receive data from the user',
  total_light_sleep_time: 'Total time the user spent in light sleep',
  total_slow_wave_sleep_time: 'Total time the user spent in deep/slow wave sleep',
  total_rem_sleep_time: 'Total time the user spent in REM sleep',
  total_restorative_sleep: 'Total time the user spent in restorative sleep (slow wave + REM)',
  sleep_cycle_count: 'Number of sleep cycles during the user\'s sleep',
  disturbance_count: 'Number of the user was disturbed during sleep',

  // Sleep needed (nested object)
  sleep_needed: 'Breakdown of the amount of sleep a user needed before the sleep activity',
  total_sleep_needed: 'Total sleep needed by the user prior to this sleep activity; it\'s the sum of all individual components',
  baseline: 'The amount of sleep a user needed based on historical trends',
  need_from_sleep_debt: 'The difference between the amount of sleep the user\'s body required and the amount the user actually got',
  need_from_recent_strain: 'Additional sleep need accrued based on the user\'s strain',
  need_from_recent_nap: 'Reduction in sleep need accrued based on the user\'s recent naps (negative value or zero)',

  // Top-level sleep metrics
  respiratory_rate: 'The user\'s respiratory rate during the sleep, in breaths per minute',
  sleep_performance_percentage: 'A percentage of the time a user is asleep over the amount of sleep the user needed. Optimal: ≥85%, Sufficient: 70-85%, Poor: <70%',
  sleep_consistency_percentage: 'Percentage of how similar this sleep and wake times compared to the previous day',
  sleep_efficiency_percentage: 'A percentage of the time the user spends in bed that they are actually asleep.',
  sleep_performance_level: 'Whoop\'s label for the sleep performance percentage: OPTIMAL, SUFFICIENT, or POOR',
  sleep_performance_level_description: 'Whoop\'s official description for this sleep performance level',
  sleep_start: 'The approximate time the user fell asleep, in the user\'s local timezone',
  sleep_end: 'The approximate time the user woke up, in the user\'s local timezone',
};

export const RECOVERY_FIELD_DESCRIPTIONS = {
  date: 'Date of recovery data (ISO 8601)',
  recovery_score: 'Percentage (0-100%) that reflects how well prepared the user\'s body is to take on Strain; it\s is a measure of the user body\'s "return to baseline" after a stressor. Sufficient: ≥67%, Adequate: 34-66%, Low: <34%',
  recovery_level: 'Whoop\'s label for the user\'s recovery level: SUFFICIENT, ADEQUATE, or LOW',
  recovery_level_description: 'Whoop\'s official description for this recovery level',
  hrv_rmssd: 'The user\'s Heart Rate Variability measured using Root Mean Square of Successive Differences (RMSSD), in milliseconds',
  resting_heart_rate: 'The user\'s resting heart rate in BPM, measured towards the end of their sleep cycle when their body is in Slow Wave Sleep',
  spo2_percentage: 'The percentage of oxygen in the user\'s blood',
  skin_temp_celsius: 'The user\'s skin temperature, in Celsius. ',
};

export const FITNESS_FIELD_DESCRIPTIONS = {
  // Data array (sorted oldest to newest)
  data: 'Array of daily training load metrics, sorted oldest to newest (first item = oldest day)',
  date: 'Date of fitness metrics (ISO 8601)',
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
  date: 'Scheduled date/time for the workout. May include the time at which the user intends to do the workout, if they have specified one; otherwise it will be just the date.',
  name: 'Workout name',
  description: 'Workout description, possibly including structure',
  expected_tss: 'Expected Training Stress Score',
  expected_if: 'Expected Intensity Factor (as percentage)',
  expected_duration: 'Expected duration of the workout',
  sport: 'Sport/activity type of the workout: Cycling, Running, or Swimming',
  source: 'Calendar source: intervals.icu, trainerroad, or zwift',
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
  date_of_birth: 'Date of birth in ISO 8601 format. Only present if set in Intervals.icu.',
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
  average_gradient: 'Average gradient as a percentage',

  // W\'bal (anaerobic capacity)
  wbal_start_j: 'W\'bal at interval start in joules; remaining anaerobic capacity',
  wbal_end_j: 'W\'bal at interval end in joules',
  joules_above_ftp: 'Work done above FTP in joules; anaerobic contribution',

  // Heat metrics (only present if heat strain data available)
  min_heat_strain_index: 'Minimum heat strain index during the interval',
  max_heat_strain_index: 'Maximum heat strain index during the interval',
  median_heat_strain_index: 'Median heat strain index during the interval.',
  start_heat_strain_index: 'Heat strain index at the start of the interval',
  end_heat_strain_index: 'Heat strain index at the end of the interval',

  // Ambient temperature metrics (only present if temperature data available)
  min_ambient_temperature: 'Minimum ambient temperature (water temperature for swimming, air temperature for other activities) during the interval in Celsius, recorded by the user\'s watch or bike computer.',
  max_ambient_temperature: 'Maximum ambient temperature (water temperature for swimming, air temperature for other activities) during the interval in Celsius, recorded by the user\'s watch or bike computer.',
  median_ambient_temperature: 'Median ambient temperature (water temperature for swimming, air temperature for other activities) during the interval in Celsius, recorded by the user\'s watch or bike computer. Use this when reporting water temperature for swimming activities.',
  start_ambient_temperature: 'Ambient temperature (water temperature for swimming, air temperature for other activities) at the start of the interval in Celsius, recorded by the user\'s watch or bike computer.',
  end_ambient_temperature: 'Ambient temperature (water temperature for swimming, air temperature for other activities) at the end of the interval in Celsius, recorded by the user\'s watch or bike computer.',

  // Group fields
  count: 'Number of repetitions in this interval set',
};

export const WEATHER_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique ID of the activity in Intervals.icu',
  weather_description: 'Weather summary for the activity. Null if weather data is unavailable (e.g., indoor activities).',
};

export const HEAT_ZONES_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique ID of the activity in Intervals.icu',
  heat_zones: WORKOUT_FIELD_DESCRIPTIONS.heat_zones,
  max_heat_strain_index: WORKOUT_FIELD_DESCRIPTIONS.max_heat_strain_index,
  median_heat_strain_index: WORKOUT_FIELD_DESCRIPTIONS.median_heat_strain_index,
  heat_training_load: 'Heat Training Load (HTL) score from 0-10, measuring the contribution of this activity to heat adaptation. Note: This is an approximation based on CORE\'s published documentation; the exact proprietary formula is not publicly available.',
};

export const POWER_CURVE_FIELD_DESCRIPTIONS = {
  // Response structure
  period_start: 'Start date of analysis period (ISO 8601)',
  period_end: 'End date of analysis period (ISO 8601)',
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
  period_start: 'Start date of analysis period (ISO 8601)',
  period_end: 'End date of analysis period (ISO 8601)',
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
  period_start: 'Start date of analysis period (ISO 8601)',
  period_end: 'End date of analysis period (ISO 8601)',
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
  start_date: 'Start date of wellness data period (ISO 8601)',
  end_date: 'End date of wellness data period (ISO 8601)',
  data: 'Array of daily wellness entries, sorted oldest to newest',

  // Daily wellness fields
  date: 'Date of wellness entry (ISO 8601)',
  weight: 'Body weight with unit (e.g., "74.8 kg")',

  // Heart rate and HRV
  resting_hr: 'Resting heart rate in BPM',
  hrv: 'Heart rate variability (rMSSD) in milliseconds',
  hrv_sdnn: 'Heart rate variability (SDNN) in milliseconds',

  // Menstrual cycle
  menstrual_phase: 'Current menstrual cycle phase',
  menstrual_phase_predicted: 'Predicted menstrual cycle phase',

  // Nutrition
  kcal_consumed: 'Calories consumed',

  // Sleep
  sleep_duration: 'Sleep duration (e.g., "8h 10m")',
  sleep_score: 'Sleep score (0-100)',
  sleep_quality: 'Subjective sleep quality: 1=GREAT, 2=GOOD, 3=AVG, 4=POOR',
  avg_sleeping_hr: 'Average heart rate during sleep in BPM',

  // Subjective metrics (1-4 scale)
  soreness: 'Pre-training soreness level: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME',
  fatigue: 'Pre-training fatigue level: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME',
  stress: 'Stress level: 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME',
  mood: 'Mood: 1=GREAT, 2=GOOD, 3=OK, 4=GRUMPY',
  motivation: 'Motivation level: 1=EXTREME, 2=HIGH, 3=AVG, 4=LOW',
  injury: 'Injury status: 1=NONE, 2=NIGGLE, 3=POOR, 4=INJURED',
  hydration: 'Hydration level: 1=GOOD, 2=OK, 3=POOR, 4=BAD',

  // Vitals
  spo2: 'Blood oxygen saturation percentage',
  blood_pressure: 'Blood pressure with systolic and diastolic values in mmHg',
  hydration_volume: 'Volume of fluids consumed in milliliters',
  respiration: 'Respiration rate in breaths per minute',

  // Readiness and body composition
  readiness: 'Overall readiness score (0-100)',
  baevsky_si: 'Baevsky stress index',
  blood_glucose: 'Blood glucose level in mg/dL',
  lactate: 'Blood lactate level in mmol/L',
  body_fat: 'Body fat percentage',
  abdomen: 'Abdominal circumference in cm',
  vo2max: 'Estimated VO2max in mL/kg/min',

  // Activity and notes
  steps: 'Step count for the day',
  comments: 'User notes/comments for the day',
};

export const DAILY_SUMMARY_FIELD_DESCRIPTIONS = {
  // Top-level daily summary fields
  current_time: 'Current date and time for the user, in their local timezone. Use this to understand the time of day when the summary was requested; that context may be important for the metrics shown.',
  workouts_completed: 'Number of workouts completed so far today',
  workouts_planned: 'Number of workouts planned for today',
  tss_completed: 'Total Training Stress Score from completed workouts',
  tss_planned: 'Total expected Training Stress Score from planned workouts',
};

export const TODAYS_RECOVERY_FIELD_DESCRIPTIONS = {
  current_time: 'Current date and time for the user, in their local timezone.',
  sleep: 'Today\'s Whoop sleep data. Null if Whoop is not configured or data is unavailable.',
  recovery: 'Today\'s Whoop recovery data. Null if Whoop is not configured or data is unavailable.',
};

export const TODAYS_STRAIN_FIELD_DESCRIPTIONS = {
  current_time: 'Current date and time for the user, in their local timezone. Use this to understand the time of day; this context shows how much strain has been accumulated so far today.',
  strain: 'Today\'s Whoop strain data. Null if Whoop is not configured or data is unavailable.',
};

export const TODAYS_COMPLETED_WORKOUTS_FIELD_DESCRIPTIONS = {
  current_time: 'Current date and time for the user, in their local timezone.',
  workouts: 'Array of completed workouts from Intervals.icu with matched Whoop data. Empty array if no workouts completed today.',
};

export const TODAYS_PLANNED_WORKOUTS_FIELD_DESCRIPTIONS = {
  current_time: 'Current date and time for the user, in their local timezone.',
  workouts: 'Array of planned workouts from TrainerRoad and Intervals.icu for today. Empty array if no workouts planned.',
};

type FieldCategory =
  | 'workout'
  | 'whoop'
  | 'body_measurements'
  | 'sleep'
  | 'recovery'
  | 'fitness'
  | 'planned'
  | 'athlete_profile'
  | 'sport_settings'
  | 'intervals'
  | 'weather'
  | 'heat_zones'
  | 'power_curve'
  | 'pace_curve'
  | 'hr_curve'
  | 'wellness'
  | 'daily_summary'
  | 'todays_recovery'
  | 'todays_strain'
  | 'todays_completed_workouts'
  | 'todays_planned_workouts';

/**
 * Get descriptions for a specific category
 */
export function getFieldDescriptions(category: FieldCategory): Record<string, string> {
  switch (category) {
    case 'workout':
      return WORKOUT_FIELD_DESCRIPTIONS;
    case 'whoop':
      return WHOOP_FIELD_DESCRIPTIONS;
    case 'body_measurements':
      return BODY_MEASUREMENTS_FIELD_DESCRIPTIONS;
    case 'sleep':
      return SLEEP_FIELD_DESCRIPTIONS;
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
    case 'weather':
      return WEATHER_FIELD_DESCRIPTIONS;
    case 'heat_zones':
      return HEAT_ZONES_FIELD_DESCRIPTIONS;
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
    case 'todays_recovery':
      return TODAYS_RECOVERY_FIELD_DESCRIPTIONS;
    case 'todays_strain':
      return TODAYS_STRAIN_FIELD_DESCRIPTIONS;
    case 'todays_completed_workouts':
      return TODAYS_COMPLETED_WORKOUTS_FIELD_DESCRIPTIONS;
    case 'todays_planned_workouts':
      return TODAYS_PLANNED_WORKOUTS_FIELD_DESCRIPTIONS;
  }
}

/**
 * Detailed heat zones summary - only shown when heat data is present
 */
const HEAT_ZONES_SUMMARY = `

Heat Zones Summary

Zone 1: No Heat Strain (0-0.9 HSI)
Impact on the Body: You are not experiencing heat strain. While core temperature may be elevated, skin temperature is neutral, allowing you to cool down and perform.
Impact on Performance: Optimal power/pace during training and racing.
Guidelines for Pacing: Pacing Not Affected - Both core and skin temperatures are elevated. Heart rate may be slightly higher than usual. You may feel warm.
Guidelines for Heat Training: No Heat Training - Training in this zone does not result in heat adaptations.

Zone 2: Moderate Heat Strain (1-2.9 HSI)
Impact on the Body: Both core and skin temperatures are elevated. Heart rate may be slightly higher than usual. You may feel warm.
Impact on Performance: Potential Performance Decline - Performance may be lower than usual.
Guidelines for Pacing: Use Discretion - Adjust pacing if needed, hydrate, and cool.
Guidelines for Heat Training: Partial Heat Training - Training in this zone may result in partial heat adaptations.

Zone 3: High Heat Strain (3-6.9 HSI)
Impact on the Body: You have high core and skin temperatures. You are sweating heavily, and more blood is transported to the skin to cool down. To maintain the same power/pace, your heart will have to pump faster to maintain oxygen supply to the muscles. This means you will have a higher heart rate than usual. You are feeling hot, and perhaps less motivated to exercise.
Impact on Performance: Performance Decline - Your exercise capacity is substantially reduced. A higher effort is required to maintain a given power/pace. Exhaustion will occur earlier.
Guidelines for Pacing: Adjust Pacing, Hydrate, and Cool - Take into account that for a given power/pace, your heart rate will be higher. Adjust pacing according to your heart rate and subjective feeling. Good hydration and cooling can help you finish faster.
Guidelines for Heat Training: Optimal Heat Training - Training in this zone results in optimal heat adaptations. To gain adaptations, you need to feel hot and sweat heavily.

Zone 4: Extremely High Heat Strain (>7 HSI)
Impact on the Body: Exercising in this zone for too long may have severe consequences for your health and may place you at risk for heat-related illness. Warning signals are muscle cramps, dizziness, nausea, headache and/or collapse.
Impact on Performance: Dangerous - Exercising in this zone for too long can cause serious health problems. Performance will be drastically reduced, and you may even need to stop exercising.
Guidelines for Pacing: Reduce HSI Rapidly - Reduce intensity or stop exercise, and cool down rapidly. Consult a medical expert if you are experiencing symptoms.
Guidelines for Heat Training: Harmful - Training in this zone may cause harm. Reduce intensity or stop exercise, and cool down rapidly. Consult a medical expert if you are experiencing symptoms.`;

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

/**
 * Enhance field descriptions with heat zones summary if heat data is present.
 * This adds the detailed heat zones explanation only when the data contains heat information.
 *
 * @param descriptions - Base field descriptions
 * @param data - The response data to check for heat zones
 * @returns Enhanced descriptions with heat zones summary if applicable
 */
export function enhanceWithHeatZonesSummary(
  descriptions: Record<string, string>,
  data: any
): Record<string, string> {
  // Check if data contains heat zones
  const hasHeatZones =
    data?.heat_zones ||
    data?.workouts?.some((w: any) => w.heat_zones) ||
    data?.completed_workouts?.some((w: any) => w.heat_zones) ||
    (Array.isArray(data) && data.some((item: any) => item.heat_zones));

  if (hasHeatZones && descriptions.heat_zones) {
    return {
      ...descriptions,
      heat_zones: descriptions.heat_zones + HEAT_ZONES_SUMMARY,
    };
  }

  return descriptions;
}

