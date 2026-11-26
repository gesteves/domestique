/**
 * Unit formatting utilities for human-readable output.
 *
 * Formatters take metric inputs (kilometers, meters, kilograms, Celsius, etc.)
 * and emit human-readable strings whose unit token reflects the athlete's
 * Intervals.icu preferences. Preferences are read from the request-scoped
 * AsyncLocalStorage in `unit-context.ts`; outside a request they default to
 * metric.
 */
import { getCurrentUnitPreferences } from './unit-context.js';

const KM_TO_MILES = 0.621371192;
const METERS_TO_FEET = 3.2808399;
const KG_TO_LB = 2.20462262;
const METERS_TO_INCHES = 39.3700787;

// ──────────────────────────────────────────────────────────────────────────
// Duration, distance, pace, speed & swim-specific formatters and parsers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Format duration in seconds to human-readable string.
 * Always uses h:mm:ss format to avoid ambiguity.
 * @param seconds Duration in seconds
 * @returns Formatted string like "1:30:00" or "0:05:00"
 */
export function formatDuration(seconds: number): string {
  // Round once up front, then split: rounding the seconds component after
  // flooring minutes can produce ":60" (e.g. 1799.6 s → "0:29:60").
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  // Always use h:mm:ss format to avoid ambiguity (e.g., "0:05:00" not "5:00")
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format distance to human-readable string.
 *
 * For swims, the unit follows the pool when the pool is one of the four
 * standard lengths: SCY (22.86 m / 25 yd) and LCY (45.72 m / 50 yd) → yards;
 * SCM (25 m) and LCM (50 m) → meters. Open water and non-standard pool sizes
 * fall back to the athlete's measurement preference (`system`).
 *
 * Non-swim distances follow `system`: km for metric, mi for imperial.
 *
 * @param km Distance in kilometers
 * @param isSwim Whether this is a swimming activity
 * @param poolLengthM Pool length in meters (only consulted when isSwim is true)
 * @returns Formatted string like "42.5 km", "26.4 mi", "2500 m", or "2000 yd"
 */
export function formatDistance(km: number, isSwim: boolean, poolLengthM?: number): string {
  if (isSwim) {
    const meters = km * 1000;
    if (isYardPool(poolLengthM)) {
      return `${Math.round(meters * METERS_TO_YARDS)} yd`;
    }
    if (isMeterPool(poolLengthM)) {
      return `${Math.round(meters)} m`;
    }
    // Open water or non-standard pool: follow system preference
    if (getCurrentUnitPreferences().system === 'imperial') {
      return `${Math.round(meters * METERS_TO_YARDS)} yd`;
    }
    return `${Math.round(meters)} m`;
  }
  if (getCurrentUnitPreferences().system === 'imperial') {
    return `${(km * KM_TO_MILES).toFixed(1)} mi`;
  }
  return `${km.toFixed(1)} km`;
}

const METERS_TO_YARDS = 1.0936133;

/**
 * Detect whether a pool length corresponds to a yards-based pool — 25yd
 * (22.86 m) or 50yd (45.72 m). Allows ±0.1 m tolerance for sensor/source noise.
 *
 * Pool unit is fixed by the pool itself (SCY vs SCM/LCM), not by the athlete's
 * unit preference, so this is a property of the data not the user.
 */
export function isYardPool(poolLengthM: number | undefined | null): boolean {
  if (poolLengthM == null) return false;
  return Math.abs(poolLengthM - 22.86) < 0.1 || Math.abs(poolLengthM - 45.72) < 0.1;
}

/**
 * Detect whether a pool length corresponds to a standard meters pool —
 * 25 m (SCM) or 50 m (LCM). Allows ±0.1 m tolerance for sensor noise.
 */
export function isMeterPool(poolLengthM: number | undefined | null): boolean {
  if (poolLengthM == null) return false;
  return Math.abs(poolLengthM - 25) < 0.1 || Math.abs(poolLengthM - 50) < 0.1;
}

/**
 * Format a pool length, picking the unit from the length itself (yards for
 * SCY / LCY pools, meters otherwise).
 */
export function formatPoolLength(poolLengthM: number): string {
  if (isYardPool(poolLengthM)) {
    return `${Math.round(poolLengthM * METERS_TO_YARDS)} yd`;
  }
  return `${Math.round(poolLengthM)} m`;
}

/**
 * Format a swim stroke length (per-stroke distance) using pool-aware units.
 * @param meters Per-stroke distance in meters (as reported by the watch)
 * @param poolLengthM Pool length in meters (or undefined for open water)
 * @returns Formatted string like "1.42 m" or "1.55 yd"
 */
export function formatStrokeLength(meters: number, poolLengthM: number | undefined | null): string {
  if (isYardPool(poolLengthM)) {
    return `${(meters * METERS_TO_YARDS).toFixed(2)} yd`;
  }
  return `${meters.toFixed(2)} m`;
}

/**
 * Format speed to human-readable string. Reflects the athlete's measurement
 * preference (km/h for metric, mph for imperial). Used for activity speeds
 * only — wind speed has its own dedicated formatter that respects the
 * separate `wind` preference.
 *
 * @param kph Speed in kilometers per hour
 * @returns Formatted string like "32.5 km/h" or "20.2 mph"
 */
export function formatSpeed(kph: number): string {
  if (getCurrentUnitPreferences().system === 'imperial') {
    return `${(kph * KM_TO_MILES).toFixed(1)} mph`;
  }
  return `${kph.toFixed(1)} km/h`;
}

/**
 * Format pace to human-readable string. Reflects the athlete's measurement
 * preference: per-kilometer for metric, per-mile for imperial. Swim pace
 * uses /100m for metric and /100yd for imperial regardless of pool.
 *
 * @param secPerKm Pace in seconds per kilometer
 * @param isSwim Whether this is a swimming activity
 * @returns Formatted string like "4:30/km", "7:14/mi", "1:45/100m", or "1:36/100yd"
 */
export function formatPace(secPerKm: number, isSwim: boolean): string {
  const isImperial = getCurrentUnitPreferences().system === 'imperial';
  if (isSwim) {
    // Per-100 metric distance: convert sec/km → sec/100m, then optionally to sec/100yd.
    const secPer100m = secPerKm / 10;
    const sec = Math.round(isImperial ? secPer100m / METERS_TO_YARDS : secPer100m);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}/${isImperial ? '100yd' : '100m'}`;
  }
  const sec = Math.round(isImperial ? secPerKm / KM_TO_MILES : secPerKm);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}/${isImperial ? 'mi' : 'km'}`;
}

/**
 * Check if an activity type is swimming.
 * @param activityType The activity type string
 * @returns True if the activity is swimming
 */
export function isSwimmingActivity(activityType: string): boolean {
  const swimTypes = ['Swimming', 'Swim', 'OpenWaterSwim', 'Pool', 'PoolSwim'];
  return swimTypes.some(
    (type) => activityType.toLowerCase().includes(type.toLowerCase())
  );
}

/**
 * Parse a duration string (h:mm:ss) back to hours.
 * @param duration String like "7:12:40" or "0:45:00"
 * @returns Duration in hours (e.g., 7.21)
 */
export function parseDurationToHours(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h + m / 60 + s / 3600;
  }
  return 0;
}

/**
 * Parse a duration string (h:mm:ss) back to seconds.
 * @param duration String like "7:12:40" or "0:45:00"
 * @returns Duration in seconds (e.g., 25960)
 */
export function parseDurationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  return 0;
}

/**
 * Format a signed duration difference in h:mm:ss with an explicit sign, e.g.
 * "-0:00:50" (50 s faster) or "+0:01:05". Zero renders as "0:00:00".
 * @param seconds Signed duration in seconds
 */
export function formatSignedDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  if (rounded === 0) return formatDuration(0);
  return `${rounded < 0 ? '-' : '+'}${formatDuration(Math.abs(rounded))}`;
}

/**
 * Format a large duration in seconds to human-readable string with total hours.
 * Uses HHH:MM:SS format for durations that may span many hours.
 * @param seconds Duration in seconds
 * @returns Formatted string like "508:30:00" or "3:45:00"
 */
export function formatLargeDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format duration in seconds to a compact human-readable label.
 * @param seconds Duration in seconds
 * @returns Formatted string like "5s", "1min", or "1hr"
 */
export function formatDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}min`;
  }
  const hours = Math.floor(seconds / 3600);
  return `${hours}hr`;
}

// ──────────────────────────────────────────────────────────────────────────
// Core metric formatters (power, HR, temperature, weight, energy, cadence, …)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Format power in watts.
 * @param watts Power in watts
 * @returns Formatted string like "220 W"
 */
export function formatPower(watts: number): string {
  return `${Math.round(watts)} W`;
}

/**
 * Format heart rate in beats per minute.
 * @param bpm Heart rate in BPM
 * @returns Formatted string like "165 bpm"
 */
export function formatHR(bpm: number): string {
  return `${Math.round(bpm)} bpm`;
}

/**
 * Format a percentage value.
 * @param value Numeric percentage (e.g., 82 for 82%)
 * @param decimals Number of decimals to keep (default 0)
 * @returns Formatted string like "82%" or "82.5%"
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a temperature, taking Celsius and emitting the athlete's preferred
 * temperature unit.
 * @param celsius Temperature in degrees Celsius
 * @returns Formatted string like "18.0 °C" or "64.4 °F"
 */
export function formatTemperature(celsius: number): string {
  if (getCurrentUnitPreferences().temperature === 'fahrenheit') {
    return `${(celsius * 9 / 5 + 32).toFixed(1)} °F`;
  }
  return `${celsius.toFixed(1)} °C`;
}

/**
 * Format body weight, taking kilograms and emitting the athlete's preferred
 * weight unit.
 * @param kg Weight in kilograms
 * @returns Formatted string like "75.9 kg" or "167.3 lb"
 */
export function formatWeight(kg: number): string {
  if (getCurrentUnitPreferences().weight === 'lb') {
    return `${(kg * KG_TO_LB).toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

/**
 * Format an athlete's physical stature height. Uses centimeters (whole) for
 * metric and feet+inches for imperial, per the athlete's `height` preference.
 * Do not use for stride length, elevation, or other lengths — see
 * `formatStride` and `formatLength`.
 *
 * @param m Height in meters
 * @returns Formatted string like "171 cm" or `5'7"`
 */
export function formatHeight(m: number): string {
  if (getCurrentUnitPreferences().height === 'feet') {
    const totalInches = Math.round(m * METERS_TO_INCHES);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}'${inches}"`;
  }
  return `${Math.round(m * 100)} cm`;
}

/**
 * Format a stride length (per-step distance for runners; not athlete stature).
 * Reflects the athlete's measurement preference: meters for metric, feet for
 * imperial. Two decimals so subtle gait changes are visible.
 *
 * @param m Stride length in meters
 * @returns Formatted string like "1.71 m" or "5.61 ft"
 */
export function formatStride(m: number): string {
  if (getCurrentUnitPreferences().system === 'imperial') {
    return `${(m * METERS_TO_FEET).toFixed(2)} ft`;
  }
  return `${m.toFixed(2)} m`;
}

/**
 * Format a length in meters as a whole number — for altitude, elevation gain,
 * etc. Reflects the athlete's measurement preference (meters for metric, feet
 * for imperial). Pool length has its own intrinsic-unit formatter.
 *
 * @param m Length in meters
 * @returns Formatted string like "1234 m" or "4049 ft"
 */
export function formatLength(m: number): string {
  if (getCurrentUnitPreferences().system === 'imperial') {
    return `${Math.round(m * METERS_TO_FEET)} ft`;
  }
  return `${Math.round(m)} m`;
}

/**
 * Format energy in joules.
 * @param joules Energy in joules
 * @returns Formatted string like "12345 J"
 */
export function formatEnergy(joules: number): string {
  return `${Math.round(joules)} J`;
}

/**
 * Format energy already expressed in kilojoules.
 * @param kj Energy in kilojoules
 * @returns Formatted string like "1234 kJ"
 */
export function formatEnergyKJ(kj: number): string {
  return `${Math.round(kj)} kJ`;
}

/**
 * Format dietary/metabolic energy in kilocalories (the "Calories" on food
 * labels and in Whoop/Intervals.icu).
 * @param kcal Energy in kilocalories
 * @returns Formatted string like "650 kcal"
 */
export function formatCalories(kcal: number): string {
  return `${Math.round(kcal)} kcal`;
}

/**
 * Format cadence with sport-aware units. Running and swimming use steps/strokes
 * per minute (`spm`); cycling and other activities use revolutions per minute (`rpm`).
 * @param value Cadence value (rounded to whole number)
 * @param sport Activity type (e.g., "Running", "Cycling", "Swim")
 * @returns Formatted string like "88 rpm" or "180 spm"
 */
export function formatCadence(value: number, sport: string): string {
  const unit = isStepLikeActivity(sport) ? 'spm' : 'rpm';
  return `${Math.round(value)} ${unit}`;
}

/**
 * Whether an activity's cadence is counted in steps/strokes rather than
 * pedal revolutions (running, walking, hiking, swimming). Stride and stroke
 * length are only meaningful for these; for cycling, Intervals.icu's
 * `average_stride` is distance per pedal revolution and is suppressed.
 * @param sport Activity type (e.g., "Running", "VirtualRide", "Swim")
 */
export function isStepLikeActivity(sport: string): boolean {
  const lower = sport.toLowerCase();
  return lower.includes('run') || lower.includes('walk') || lower.includes('hike') || lower.includes('swim');
}

/**
 * Format mass in grams.
 * @param grams Mass in grams
 * @returns Formatted string like "180 g"
 */
export function formatMass(grams: number): string {
  return `${Math.round(grams)} g`;
}

/**
 * Format an HRV value in milliseconds.
 * @param ms HRV in milliseconds
 * @returns Formatted string like "55 ms"
 */
export function formatHRV(ms: number): string {
  return `${Math.round(ms)} ms`;
}

/**
 * Format an estimated VO2max value.
 * @param value VO2max in mL/kg/min
 * @returns Formatted string like "55.0 mL/kg/min"
 */
export function formatVO2max(value: number): string {
  return `${value.toFixed(1)} mL/kg/min`;
}

/**
 * Format a blood pressure reading.
 * @param systolic Systolic pressure
 * @param diastolic Diastolic pressure
 * @returns Formatted string like "120/80 mmHg"
 */
export function formatBP(systolic: number, diastolic: number): string {
  return `${Math.round(systolic)}/${Math.round(diastolic)} mmHg`;
}

/**
 * Round a unitless score to a fixed number of decimal places, passing
 * null/undefined through. Use at normalization time for bare numerics
 * (CTL/ATL/TSB, IF, strain, TRIMP, …) so responses don't carry float noise
 * like `2.494519000000004`.
 * @param value Number to round
 * @param decimals Decimal places to keep (default 0)
 */
export function roundTo(value: number, decimals?: number): number;
export function roundTo(value: number | null | undefined, decimals?: number): number | undefined;
export function roundTo(value: number | null | undefined, decimals = 0): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  // Normalize -0 to 0 so a rounded tiny negative doesn't render as "-0".
  return Math.round(value * factor) / factor || 0;
}

/**
 * Generic helper that suffixes a unit to a numeric value.
 * Use for one-off units (mg/dL, mmol/L, breaths/min, ml, cm, ...) that don't
 * warrant a dedicated helper.
 * @param value Numeric value
 * @param unit Unit suffix (e.g., "mg/dL")
 * @param decimals Decimals to keep (default 0)
 * @returns Formatted string like "95 mg/dL"
 */
export function withUnit(value: number, unit: string, decimals = 0): string {
  return `${value.toFixed(decimals)} ${unit}`;
}

const RPE_LABELS: Record<number, string> = {
  1: 'Nothing at all',
  2: 'Very easy',
  3: 'Easy',
  4: 'Comfortable',
  5: 'Slightly challenging',
  6: 'Difficult',
  7: 'Hard',
  8: 'Very hard',
  9: 'Extremely hard',
  10: 'Max effort',
};

const FEEL_LABELS: Record<number, string> = {
  1: 'Strong',
  2: 'Good',
  3: 'Normal',
  4: 'Poor',
  5: 'Weak',
};

// ──────────────────────────────────────────────────────────────────────────
// Wellness 1–10 / 1–4 scale formatters (RPE, feel, soreness, mood, …)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Format an RPE value (1–10) as "[number] - label".
 * Returns undefined for values outside 1–10.
 */
export function formatRpe(value: number): string | undefined {
  const n = Math.round(value);
  const label = RPE_LABELS[n];
  return label ? `${n} - ${label}` : undefined;
}

/**
 * Format a Feel value (1–5; 1=Strong, 5=Weak) as "[number] - label".
 * Returns undefined for values outside 1–5.
 */
export function formatFeel(value: number): string | undefined {
  const n = Math.round(value);
  const label = FEEL_LABELS[n];
  return label ? `${n} - ${label}` : undefined;
}

const SORENESS_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Avg',
  3: 'High',
  4: 'Extreme',
};

const FATIGUE_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Avg',
  3: 'High',
  4: 'Extreme',
};

const MOOD_LABELS: Record<number, string> = {
  1: 'Great',
  2: 'Good',
  3: 'OK',
  4: 'Grumpy',
};

const MOTIVATION_LABELS: Record<number, string> = {
  1: 'Extreme',
  2: 'High',
  3: 'Avg',
  4: 'Low',
};

const INJURY_LABELS: Record<number, string> = {
  1: 'None',
  2: 'Niggle',
  3: 'Poor',
  4: 'Injured',
};

const SLEEP_QUALITY_LABELS: Record<number, string> = {
  1: 'Great',
  2: 'Good',
  3: 'Avg',
  4: 'Poor',
};

const STRESS_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Avg',
  3: 'High',
  4: 'Extreme',
};

const HYDRATION_LABELS: Record<number, string> = {
  1: 'Good',
  2: 'OK',
  3: 'Poor',
  4: 'Bad',
};

function formatScale(value: number, labels: Record<number, string>): string | undefined {
  const n = Math.round(value);
  const label = labels[n];
  return label ? `${n} - ${label}` : undefined;
}

/** Format a pre-training soreness value (1–4) as "[number] - label". */
export function formatSoreness(value: number): string | undefined {
  return formatScale(value, SORENESS_LABELS);
}

/** Format a pre-training fatigue value (1–4) as "[number] - label". */
export function formatFatigue(value: number): string | undefined {
  return formatScale(value, FATIGUE_LABELS);
}

/** Format a mood value (1–4) as "[number] - label". */
export function formatMood(value: number): string | undefined {
  return formatScale(value, MOOD_LABELS);
}

/** Format a motivation value (1–4) as "[number] - label". */
export function formatMotivation(value: number): string | undefined {
  return formatScale(value, MOTIVATION_LABELS);
}

/** Format an injury status value (1–4) as "[number] - label". */
export function formatInjury(value: number): string | undefined {
  return formatScale(value, INJURY_LABELS);
}

/** Format a subjective sleep quality value (1–4) as "[number] - label". */
export function formatSleepQuality(value: number): string | undefined {
  return formatScale(value, SLEEP_QUALITY_LABELS);
}

/** Format a stress value (1–4) as "[number] - label". */
export function formatStress(value: number): string | undefined {
  return formatScale(value, STRESS_LABELS);
}

/** Format a hydration value (1–4) as "[number] - label". */
export function formatHydration(value: number): string | undefined {
  return formatScale(value, HYDRATION_LABELS);
}
