/**
 * Whoop insight computation utilities.
 * Pre-computes interpretations for Whoop's proprietary metrics using their official terminology.
 */

import type { RecoveryData, StrainData } from '../types/index.js';

// Whoop's official terminology for recovery levels
export type RecoveryLevel = 'SUFFICIENT' | 'ADEQUATE' | 'LOW';

// Whoop's official terminology for strain levels
export type StrainLevel = 'LIGHT' | 'MODERATE' | 'HIGH' | 'ALL_OUT';

// Sleep performance levels
export type SleepPerformanceLevel = 'OPTIMAL' | 'SUFFICIENT' | 'POOR';

// Whoop's official descriptions for each level
const STRAIN_DESCRIPTIONS: Record<StrainLevel, string> = {
  LIGHT: 'Minimal exertion, encourages active recovery',
  MODERATE: 'Balances fitness gains and recovery',
  HIGH: 'Builds fitness, harder to recover next day',
  ALL_OUT: 'Significant exertion, risk for injury/overtraining',
};

const RECOVERY_DESCRIPTIONS: Record<RecoveryLevel, string> = {
  SUFFICIENT: 'Well recovered, ready to perform',
  ADEQUATE: 'Maintaining health, can handle moderate stress',
  LOW: 'Working hard to recover, needs rest',
};

const SLEEP_PERFORMANCE_DESCRIPTIONS: Record<SleepPerformanceLevel, string> = {
  OPTIMAL: 'Got enough sleep to fully recover',
  SUFFICIENT: 'Got adequate sleep for basic recovery',
  POOR: 'Did not get enough sleep, recovery impacted',
};

/**
 * Pre-computed insights for Whoop recovery data.
 */
export interface RecoveryInsights {
  /** Recovery level: SUFFICIENT (≥67%), ADEQUATE (34-66%), LOW (<34%) */
  recovery_level: RecoveryLevel;
  /** Human-readable description from Whoop */
  recovery_level_description: string;
  /** Sleep performance level: OPTIMAL (≥85%), SUFFICIENT (70-85%), POOR (<70%) */
  sleep_performance_level: SleepPerformanceLevel;
  /** Human-readable sleep performance description from Whoop */
  sleep_performance_level_description: string;
  /** Human-readable sleep duration, e.g., "7:12:40" */
  sleep_duration: string;
  /** Raw HRV value in milliseconds for reference */
  hrv_rmssd_ms: number;
}

/**
 * Pre-computed insights for Whoop strain data.
 */
export interface StrainInsights {
  /** Strain level: LIGHT (0-9), MODERATE (10-13), HIGH (14-17), ALL_OUT (18-21) */
  strain_level: StrainLevel;
  /** Human-readable description from Whoop */
  strain_level_description: string;
}

/**
 * Compute recovery insights from Whoop recovery data.
 *
 * Uses Whoop's official scale:
 * - SUFFICIENT (Green): ≥67% - Well recovered, ready to perform
 * - ADEQUATE (Yellow): 34-66% - Maintaining health, can handle moderate stress
 * - LOW (Red): <34% - Working hard to recover, needs rest
 */
export function computeRecoveryInsights(recovery: RecoveryData): RecoveryInsights {
  // Determine recovery level using Whoop's thresholds
  const recoveryLevel: RecoveryLevel =
    recovery.recovery_score >= 67
      ? 'SUFFICIENT'
      : recovery.recovery_score >= 34
        ? 'ADEQUATE'
        : 'LOW';

  // Determine sleep performance level using Whoop's thresholds
  const sleepPerformanceLevel: SleepPerformanceLevel =
    recovery.sleep_performance_percentage >= 85
      ? 'OPTIMAL'
      : recovery.sleep_performance_percentage >= 70
        ? 'SUFFICIENT'
        : 'POOR';

  return {
    recovery_level: recoveryLevel,
    recovery_level_description: RECOVERY_DESCRIPTIONS[recoveryLevel],
    sleep_performance_level: sleepPerformanceLevel,
    sleep_performance_level_description: SLEEP_PERFORMANCE_DESCRIPTIONS[sleepPerformanceLevel],
    sleep_duration: recovery.sleep_duration,
    hrv_rmssd_ms: recovery.hrv_rmssd,
  };
}

/**
 * Compute strain insights from Whoop strain data.
 *
 * Uses Whoop's official scale:
 * - LIGHT (0-9): Minimal exertion, encourages active recovery
 * - MODERATE (10-13): Balances fitness gains and recovery
 * - HIGH (14-17): Builds fitness, harder to recover next day
 * - ALL_OUT (18-21): Significant exertion, risk for injury/overtraining
 */
export function computeStrainInsights(strain: StrainData): StrainInsights {
  // Determine strain level using Whoop's thresholds
  const strainLevel: StrainLevel =
    strain.strain_score < 10
      ? 'LIGHT'
      : strain.strain_score < 14
        ? 'MODERATE'
        : strain.strain_score < 18
          ? 'HIGH'
          : 'ALL_OUT';

  return {
    strain_level: strainLevel,
    strain_level_description: STRAIN_DESCRIPTIONS[strainLevel],
  };
}
