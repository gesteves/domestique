/**
 * Whoop insight computation utilities.
 * Pre-computes interpretations for Whoop's proprietary metrics using their official terminology.
 */

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
 * Compute recovery level from score.
 *
 * Uses Whoop's official scale:
 * - SUFFICIENT (Green): ≥67% - Well recovered, ready to perform
 * - ADEQUATE (Yellow): 34-66% - Maintaining health, can handle moderate stress
 * - LOW (Red): <34% - Working hard to recover, needs rest
 */
export function getRecoveryLevel(recoveryScore: number): RecoveryLevel {
  return recoveryScore >= 67
    ? 'SUFFICIENT'
    : recoveryScore >= 34
      ? 'ADEQUATE'
      : 'LOW';
}

/**
 * Get description for a recovery level.
 */
export function getRecoveryLevelDescription(level: RecoveryLevel): string {
  return RECOVERY_DESCRIPTIONS[level];
}

/**
 * Compute sleep performance level from percentage.
 *
 * Uses Whoop's official scale:
 * - OPTIMAL: ≥85% - Got enough sleep to fully recover
 * - SUFFICIENT: 70-84% - Got adequate sleep for basic recovery
 * - POOR: <70% - Did not get enough sleep, recovery impacted
 */
export function getSleepPerformanceLevel(sleepPerformancePercentage: number): SleepPerformanceLevel {
  return sleepPerformancePercentage >= 85
    ? 'OPTIMAL'
    : sleepPerformancePercentage >= 70
      ? 'SUFFICIENT'
      : 'POOR';
}

/**
 * Get description for a sleep performance level.
 */
export function getSleepPerformanceLevelDescription(level: SleepPerformanceLevel): string {
  return SLEEP_PERFORMANCE_DESCRIPTIONS[level];
}

/**
 * Compute strain level from score.
 *
 * Uses Whoop's official scale:
 * - LIGHT (0-9): Minimal exertion, encourages active recovery
 * - MODERATE (10-13): Balances fitness gains and recovery
 * - HIGH (14-17): Builds fitness, harder to recover next day
 * - ALL_OUT (18-21): Significant exertion, risk for injury/overtraining
 */
export function getStrainLevel(strainScore: number): StrainLevel {
  return strainScore < 10
    ? 'LIGHT'
    : strainScore < 14
      ? 'MODERATE'
      : strainScore < 18
        ? 'HIGH'
        : 'ALL_OUT';
}

/**
 * Get description for a strain level.
 */
export function getStrainLevelDescription(level: StrainLevel): string {
  return STRAIN_DESCRIPTIONS[level];
}
