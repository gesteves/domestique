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
    high: 0.9,
  },
  {
    name: 'Zone 2: Moderate Heat Strain',
    low: 1,
    high: 2.9,
  },
  {
    name: 'Zone 3: High Heat Strain',
    low: 3,
    high: 6.9,
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
  avg_heat_strain_index: number;
  heat_training_load: number;
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
      const inZone = hsi >= zone.low && (zone.high === null || hsi <= zone.high);

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
 * @param timeData - Array of time values in seconds
 * @param heatStrainData - Array of heat strain index values (aligned with timeData)
 * @returns Heat metrics including zones, max, avg, and heat training load
 */
export function calculateHeatMetrics(
  timeData: number[],
  heatStrainData: number[]
): HeatMetrics {
  const zones = calculateHeatZones(timeData, heatStrainData);

  // Calculate max HSI
  const maxHSI = heatStrainData.length > 0 ? Math.max(...heatStrainData) : 0;

  // Calculate average HSI
  const avgHSI = heatStrainData.length > 0
    ? heatStrainData.reduce((sum, hsi) => sum + hsi, 0) / heatStrainData.length
    : 0;

  // Calculate heat training load (HTL)
  // Based on CORE documentation: HTL ranges from 0-10 and is based on time at elevated HSI
  // Zone 1 (0-0.9): No contribution
  // Zone 2 (1-2.9): Partial contribution
  // Zone 3 (3-6.9): Optimal contribution
  // Zone 4 (7+): Not recommended for training
  const htl = calculateHeatTrainingLoad(timeData, heatStrainData);

  return {
    zones,
    max_heat_strain_index: Math.round(maxHSI * 10) / 10, // Round to 1 decimal
    avg_heat_strain_index: Math.round(avgHSI * 10) / 10, // Round to 1 decimal
    heat_training_load: Math.round(htl * 10) / 10, // Round to 1 decimal
  };
}

/**
 * Calculate Heat Training Load (HTL) from stream data.
 *
 * HTL measures the contribution to heat adaptation on a 0-10 scale.
 * This is an approximation based on CORE Body Temperature documentation:
 * - Zone 1 (0-0.9 HSI): No contribution
 * - Zone 2 (1-2.9 HSI): Moderate contribution
 * - Zone 3 (3-6.9 HSI): Optimal contribution (highest HTL)
 * - Zone 4 (7+ HSI): Dangerous, not recommended
 *
 * The calculation considers both intensity (HSI level) and duration.
 *
 * @param timeData - Array of time values in seconds
 * @param heatStrainData - Array of heat strain index values
 * @returns HTL score from 0-10
 */
function calculateHeatTrainingLoad(
  timeData: number[],
  heatStrainData: number[]
): number {
  if (timeData.length === 0 || heatStrainData.length === 0) {
    return 0;
  }

  let totalWeightedLoad = 0;
  let totalTime = 0;

  for (let i = 0; i < heatStrainData.length; i++) {
    const hsi = heatStrainData[i];

    // Calculate time at this data point
    const timeSpent = i < timeData.length - 1
      ? timeData[i + 1] - timeData[i]
      : 1;

    totalTime += timeSpent;

    // Weight the contribution based on HSI zone
    // Zone 1 (0-0.9): 0% contribution
    // Zone 2 (1-2.9): 30-50% contribution (scales with HSI)
    // Zone 3 (3-6.9): 80-100% contribution (optimal, scales with HSI)
    // Zone 4 (7+): 50% contribution (dangerous, penalized)
    let weight = 0;

    if (hsi < 1.0) {
      // Zone 1: No contribution
      weight = 0;
    } else if (hsi < 3.0) {
      // Zone 2: Partial contribution (30-50%)
      // Linear scale from 30% at HSI 1.0 to 50% at HSI 2.9
      weight = 0.3 + ((hsi - 1.0) / 1.9) * 0.2;
    } else if (hsi < 7.0) {
      // Zone 3: Optimal contribution (80-100%)
      // Linear scale from 80% at HSI 3.0 to 100% at HSI 6.9
      weight = 0.8 + ((hsi - 3.0) / 3.9) * 0.2;
    } else {
      // Zone 4: Dangerous, penalized contribution (50%)
      weight = 0.5;
    }

    totalWeightedLoad += weight * timeSpent;
  }

  if (totalTime === 0) {
    return 0;
  }

  // Normalize to 0-10 scale
  // Average weighted contribution × 10
  const htl = (totalWeightedLoad / totalTime) * 10;

  // Cap at 10
  return Math.min(htl, 10);
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
