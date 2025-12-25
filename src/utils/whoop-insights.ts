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

// Whoop's official descriptions for each level, taken verbatim from the app.
const STRAIN_DESCRIPTIONS: Record<StrainLevel, string> = {
  LIGHT: 'Minimal exertion is being put on the body, which encourages active recovery.',
  MODERATE: 'Moderate exertion is being put on the body, which balances fitness gains and recovery.',
  HIGH: 'Increased exertion which builds fitness gains, but makes it more difficult for your body to recover the next day.',
  ALL_OUT: 'Significant exertion which increases fitness gains, but puts your body at greater risk for injury or overtraining.',
};


// Same as above.
const RECOVERY_DESCRIPTIONS: Record<RecoveryLevel, string> = {
  SUFFICIENT: 'Your body is well recovered and ready to perform. Whether it\'s at work or the gym, your body is signaling it can handle a strenuous day.',
  ADEQUATE: 'Your body is maintaining health. You may not need rest and can still handle a moderately strenuous day.',
  LOW: 'Your body is working hard to recover. Your body is signaling it needs an active rest day.',
};

// No official description for these, so I asked Whoop Coach to provide them.
const SLEEP_PERFORMANCE_DESCRIPTIONS: Record<SleepPerformanceLevel, string> = {
  OPTIMAL: 'You\'re getting most or all of your Sleep Need with consistent timing, high efficiency, and low sleep stress that best support recovery and long-term health.',
  SUFFICIENT: 'Your sleep is generally workable for day-to-day functioning but not fully optimized for recovery or long-term health.',
  POOR: 'You\'re meaningfully under-sleeping or your timing/quality is disrupted enough that it\'s likely to undermine your recovery and next-day performance.',
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
