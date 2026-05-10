import type { HeatZone } from '../types/index.js';
import { formatDuration } from './format-units.js';

/**
 * Heat zone definitions based on Heat Strain Index (HSI).
 * Zones are derived from the Heat Strain Index metric.
 */
const HEAT_ZONE_DEFINITIONS = [
  {
    name: 'Zone 1: No Heat Strain',
    low: 0,
    high: 1,
  },
  {
    name: 'Zone 2: Moderate Heat Strain',
    low: 1,
    high: 3,
  },
  {
    name: 'Zone 3: High Heat Strain',
    low: 3,
    high: 7,
  },
  {
    name: 'Zone 4: Extremely High Heat Strain',
    low: 7,
    high: null, // Unbounded
  },
];

/**
 * Stream data response from Intervals.icu API for heat strain index.
 */
interface StreamDataPoint {
  type: string;
  data: number[];
}

/**
 * Heat metrics calculated from stream data
 */
export interface HeatMetrics {
  zones: HeatZone[];
  max_heat_strain_index: number;
  median_heat_strain_index: number;
}

/**
 * Calculate time in each heat zone from activity stream data.
 *
 * @param timeData - Array of time values in seconds
 * @param heatStrainData - Array of heat strain index values (aligned with timeData)
 * @returns Array of HeatZone objects with time_in_zone calculated
 */
export function calculateHeatZones(
  timeData: number[],
  heatStrainData: number[]
): HeatZone[] {
  if (timeData.length !== heatStrainData.length) {
    throw new Error('Time and heat strain data arrays must have the same length');
  }

  // Initialize time counters for each zone
  const zoneTimes = new Array(HEAT_ZONE_DEFINITIONS.length).fill(0);

  // For each data point (each second), determine which zone it belongs to
  for (let i = 0; i < heatStrainData.length; i++) {
    const hsi = heatStrainData[i];

    // Find the appropriate zone for this HSI value
    for (let zoneIndex = 0; zoneIndex < HEAT_ZONE_DEFINITIONS.length; zoneIndex++) {
      const zone = HEAT_ZONE_DEFINITIONS[zoneIndex];
      const inZone = hsi >= zone.low && (zone.high === null || hsi < zone.high);

      if (inZone) {
        // Calculate time spent at this data point
        // Time is the difference to the next point (or 1 second for the last point)
        const timeSpent = i < timeData.length - 1
          ? timeData[i + 1] - timeData[i]
          : 1;

        zoneTimes[zoneIndex] += timeSpent;
        break;
      }
    }
  }

  // Build the result array with formatted durations
  return HEAT_ZONE_DEFINITIONS.map((zone, index) => ({
    name: zone.name,
    low_heat_strain_index: zone.low,
    high_heat_strain_index: zone.high,
    time_in_zone: formatDuration(zoneTimes[index]),
  }));
}

/**
 * Calculate comprehensive heat metrics from activity stream data.
 *
 * Max and the time-in-zone distribution are computed from the full stream
 * (every sample counts toward the zone the athlete spent time in).
 *
 * The **median** is computed over non-zero samples only. CORE sensor streams
 * routinely include 0-padding from the period before the sensor was engaged
 * or after it disconnected, plus the warm-up window where the body is still
 * thermoneutral. Counting those toward the median pulls it artificially to 0
 * even when the activity reached non-trivial peak strain, which reads as a
 * broken value in tool outputs. When every sample is zero the median falls
 * back to 0 (no signal to recover).
 *
 * @param timeData - Array of time values in seconds
 * @param heatStrainData - Array of heat strain index values (aligned with timeData)
 * @returns Heat metrics including zones, max, and median HSI
 */
export function calculateHeatMetrics(
  timeData: number[],
  heatStrainData: number[]
): HeatMetrics {
  const zones = calculateHeatZones(timeData, heatStrainData);

  // Calculate max HSI over the full stream — robust to 0-padding.
  const maxHSI = heatStrainData.length > 0 ? Math.max(...heatStrainData) : 0;

  // Calculate median HSI over non-zero samples (see jsdoc above). Fall back
  // to 0 when no sample is positive.
  const positive = heatStrainData.filter((v) => v > 0);
  let medianHSI = 0;
  if (positive.length > 0) {
    const sorted = positive.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianHSI = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  return {
    zones,
    max_heat_strain_index: Math.round(maxHSI * 10) / 10, // Round to 1 decimal
    median_heat_strain_index: Math.round(medianHSI * 10) / 10, // Round to 1 decimal
  };
}

/**
 * Parse stream data response from Intervals.icu API.
 *
 * @param streams - Array of stream data from the API
 * @returns Object with time and heat_strain_index arrays, or null if heat strain data not available
 */
export function parseHeatStrainStreams(
  streams: StreamDataPoint[]
): { time: number[]; heat_strain_index: number[] } | null {
  const timeStream = streams.find((s) => s.type === 'time');
  const heatStrainStream = streams.find((s) => s.type === 'heat_strain_index');

  if (!timeStream || !heatStrainStream) {
    return null;
  }

  return {
    time: timeStream.data,
    heat_strain_index: heatStrainStream.data,
  };
}
