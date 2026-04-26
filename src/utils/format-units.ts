/**
 * Unit formatting utilities for human-readable output.
 * All units are metric. The LLM can convert to imperial or mixed units as needed.
 */

/**
 * Format duration in seconds to human-readable string.
 * Always uses h:mm:ss format to avoid ambiguity.
 * @param seconds Duration in seconds
 * @returns Formatted string like "1:30:00" or "0:05:00"
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);

  // Always use h:mm:ss format to avoid ambiguity (e.g., "0:05:00" not "5:00")
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format distance to human-readable string.
 *
 * For swims, the unit follows the pool: yards for SCY (25yd / 22.86 m) and LCY
 * (50yd / 45.72 m) pools, meters otherwise. Open water and unknown pool sizes
 * default to meters. The user's broader metric/imperial preference is not
 * consulted — this is a pool-convention choice, not a unit-system choice.
 *
 * @param km Distance in kilometers
 * @param isSwim Whether this is a swimming activity (per-stroke / per-length distances)
 * @param poolLengthM Pool length in meters (only consulted when isSwim is true)
 * @returns Formatted string like "42.5 km", "2500 m", or "2000 yd"
 */
export function formatDistance(km: number, isSwim: boolean, poolLengthM?: number): string {
  if (isSwim) {
    const meters = km * 1000;
    if (isYardPool(poolLengthM)) {
      return `${Math.round(meters * METERS_TO_YARDS)} yd`;
    }
    return `${Math.round(meters)} m`;
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
 * Format speed to human-readable string.
 * @param kph Speed in kilometers per hour
 * @returns Formatted string like "32.5 km/h"
 */
export function formatSpeed(kph: number): string {
  return `${kph.toFixed(1)} km/h`;
}

/**
 * Format pace to human-readable string.
 * @param secPerKm Pace in seconds per kilometer
 * @param isSwim Whether this is a swimming activity (uses /100m)
 * @returns Formatted string like "4:30/km" or "1:45/100m"
 */
export function formatPace(secPerKm: number, isSwim: boolean): string {
  if (isSwim) {
    // Convert sec/km to sec/100m (divide by 10)
    const secPer100m = secPerKm / 10;
    const m = Math.floor(secPer100m / 60);
    const s = Math.round(secPer100m % 60);
    return `${m}:${s.toString().padStart(2, '0')}/100m`;
  }
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}/km`;
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
 * Format a large duration in seconds to human-readable string with total hours.
 * Uses HHH:MM:SS format for durations that may span many hours.
 * @param seconds Duration in seconds
 * @returns Formatted string like "508:30:00" or "3:45:00"
 */
export function formatLargeDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);

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
 * Format a temperature in Celsius.
 * @param celsius Temperature in degrees Celsius
 * @returns Formatted string like "18.0 °C"
 */
export function formatTemperature(celsius: number): string {
  return `${celsius.toFixed(1)} °C`;
}

/**
 * Format body weight in kilograms.
 * @param kg Weight in kilograms
 * @returns Formatted string like "75.9 kg"
 */
export function formatWeight(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}

/**
 * Format a height (or stride length) in meters with two decimals.
 * @param m Length in meters
 * @returns Formatted string like "1.71 m"
 */
export function formatHeight(m: number): string {
  return `${m.toFixed(2)} m`;
}

/**
 * Format a length in meters as a whole number — for altitude, pool length, etc.
 * @param m Length in meters
 * @returns Formatted string like "1234 m"
 */
export function formatLength(m: number): string {
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
 * Format cadence with sport-aware units. Running and swimming use steps/strokes
 * per minute (`spm`); cycling and other activities use revolutions per minute (`rpm`).
 * @param value Cadence value (rounded to whole number)
 * @param sport Activity type (e.g., "Running", "Cycling", "Swim")
 * @returns Formatted string like "88 rpm" or "180 spm"
 */
export function formatCadence(value: number, sport: string): string {
  const lower = sport.toLowerCase();
  const isStepLike = lower.includes('run') || lower.includes('walk') || lower.includes('swim');
  const unit = isStepLike ? 'spm' : 'rpm';
  return `${Math.round(value)} ${unit}`;
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
