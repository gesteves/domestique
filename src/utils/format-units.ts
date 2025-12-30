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
 * @param km Distance in kilometers
 * @param isSwim Whether this is a swimming activity (uses meters)
 * @returns Formatted string like "42.5 km" or "2500 m"
 */
export function formatDistance(km: number, isSwim: boolean): string {
  if (isSwim) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
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
