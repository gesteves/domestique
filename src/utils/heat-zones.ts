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
  median_heat_strain_index: number;
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

  // Calculate median HSI
  let medianHSI = 0;
  if (heatStrainData.length > 0) {
    const sorted = [...heatStrainData].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianHSI = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

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
    median_heat_strain_index: Math.round(medianHSI * 10) / 10, // Round to 1 decimal
    heat_training_load: Math.round(htl * 10) / 10, // Round to 1 decimal
  };
}

/**
 * CORE's official HTL lookup table based on duration and peak HSI.
 * Source: https://help.corebodytemp.com/en/articles/10447113-heat-training-load
 *
 * Rows: Duration in minutes (30, 45, 60, 90, 120, 180)
 * Cols: Peak HSI values (1.5, 2.5, 3.5, 4.5, 5.5, 6.5)
 * Values: HTL score (0-10)
 */
const CORE_HTL_TABLE = [
  //     1.5   2.5   3.5   4.5   5.5   6.5  <- Peak HSI
  [1.2, 2.0, 3.1, 4.7, 6.8, 9.3],  // 30min
  [1.8, 3.0, 4.6, 7.0, 10.0, 10.0], // 45min
  [2.5, 4.0, 6.2, 9.3, 10.0, 10.0], // 60min (1hr)
  [3.7, 6.0, 9.3, 10.0, 10.0, 10.0], // 90min (1.5hr)
  [4.9, 8.0, 10.0, 10.0, 10.0, 10.0], // 120min (2hr)
  [7.4, 10.0, 10.0, 10.0, 10.0, 10.0], // 180min (3hr)
];

const DURATION_POINTS = [30, 45, 60, 90, 120, 180]; // minutes
const HSI_POINTS = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];

/**
 * Bilinear interpolation for CORE HTL table lookup.
 *
 * @param duration - Duration in minutes
 * @param peakHSI - Peak HSI value
 * @returns Interpolated HTL value
 */
function interpolateHTL(duration: number, peakHSI: number): number {
  // Handle edge cases
  if (duration <= 0 || peakHSI < 1.0) {
    return 0;
  }

  // Cap at table boundaries
  const cappedDuration = Math.min(duration, DURATION_POINTS[DURATION_POINTS.length - 1]);
  const cappedHSI = Math.min(peakHSI, HSI_POINTS[HSI_POINTS.length - 1]);

  // Find bounding duration indices
  let durationIdx = 0;
  for (let i = 0; i < DURATION_POINTS.length - 1; i++) {
    if (cappedDuration >= DURATION_POINTS[i] && cappedDuration <= DURATION_POINTS[i + 1]) {
      durationIdx = i;
      break;
    }
    if (cappedDuration > DURATION_POINTS[i + 1]) {
      durationIdx = i + 1;
    }
  }

  // Find bounding HSI indices
  let hsiIdx = 0;
  for (let i = 0; i < HSI_POINTS.length - 1; i++) {
    if (cappedHSI >= HSI_POINTS[i] && cappedHSI <= HSI_POINTS[i + 1]) {
      hsiIdx = i;
      break;
    }
    if (cappedHSI > HSI_POINTS[i + 1]) {
      hsiIdx = i + 1;
    }
  }

  // If we're exactly on a grid point, return it
  if (cappedDuration === DURATION_POINTS[durationIdx] && cappedHSI === HSI_POINTS[hsiIdx]) {
    return CORE_HTL_TABLE[durationIdx][hsiIdx];
  }

  // Bilinear interpolation
  const d0 = DURATION_POINTS[durationIdx];
  const d1 = durationIdx < DURATION_POINTS.length - 1 ? DURATION_POINTS[durationIdx + 1] : d0;
  const h0 = HSI_POINTS[hsiIdx];
  const h1 = hsiIdx < HSI_POINTS.length - 1 ? HSI_POINTS[hsiIdx + 1] : h0;

  // Get four corner values
  const q00 = CORE_HTL_TABLE[durationIdx][hsiIdx];
  const q01 = hsiIdx < HSI_POINTS.length - 1 ? CORE_HTL_TABLE[durationIdx][hsiIdx + 1] : q00;
  const q10 = durationIdx < DURATION_POINTS.length - 1 ? CORE_HTL_TABLE[durationIdx + 1][hsiIdx] : q00;
  const q11 = (durationIdx < DURATION_POINTS.length - 1 && hsiIdx < HSI_POINTS.length - 1)
    ? CORE_HTL_TABLE[durationIdx + 1][hsiIdx + 1]
    : q00;

  // Interpolate
  if (d1 === d0 && h1 === h0) {
    return q00;
  } else if (d1 === d0) {
    // Linear interpolation in HSI dimension only
    const t = (cappedHSI - h0) / (h1 - h0);
    return q00 * (1 - t) + q01 * t;
  } else if (h1 === h0) {
    // Linear interpolation in duration dimension only
    const t = (cappedDuration - d0) / (d1 - d0);
    return q00 * (1 - t) + q10 * t;
  } else {
    // Full bilinear interpolation
    const td = (cappedDuration - d0) / (d1 - d0);
    const th = (cappedHSI - h0) / (h1 - h0);

    const r0 = q00 * (1 - th) + q01 * th;
    const r1 = q10 * (1 - th) + q11 * th;

    return r0 * (1 - td) + r1 * td;
  }
}

/**
 * Calculate Heat Training Load (HTL) from stream data using CORE's algorithm.
 *
 * HTL measures the contribution to heat adaptation on a 0-10 scale.
 * This implementation matches CORE Body Temperature's proprietary HTL calculation
 * based on their official lookup table.
 *
 * Algorithm (per CORE documentation):
 * 1. Calculate duration of time spent at HSI ≥ 1.0 (Zone 2+)
 * 2. Find the peak (maximum) HSI value during that time
 * 3. Look up HTL in CORE's official table using duration × peak HSI
 *
 * Source: https://help.corebodytemp.com/en/articles/10447113-heat-training-load
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

  // CORE Algorithm: Calculate duration at HSI ≥ 1.0 and find peak HSI
  let durationInZone2Plus = 0; // seconds
  let peakHSI = 0;

  for (let i = 0; i < heatStrainData.length; i++) {
    const hsi = heatStrainData[i];

    if (hsi >= 1.0) {
      // Calculate time at this data point
      const timeSpent = i < timeData.length - 1
        ? timeData[i + 1] - timeData[i]
        : 1;

      durationInZone2Plus += timeSpent;
      peakHSI = Math.max(peakHSI, hsi);
    }
  }

  // Convert duration to minutes
  const durationMinutes = durationInZone2Plus / 60;

  // Look up HTL using CORE's table
  const htl = interpolateHTL(durationMinutes, peakHSI);

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
