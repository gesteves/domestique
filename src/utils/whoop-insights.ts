/**
 * Whoop insight computation utilities.
 * Pre-computes interpretations for Whoop's proprietary metrics using their official terminology.
 */

// Whoop's official terminology for recovery levels
export type RecoveryLevel = 'Sufficient' | 'Adequate' | 'Low';

// Whoop's official terminology for strain levels
export type StrainLevel = 'Light' | 'Moderate' | 'High' | 'All out';

// Sleep performance levels
export type SleepPerformanceLevel = 'Optimal' | 'Sufficient' | 'Poor';

// Whoop's official descriptions for each level, taken verbatim from the app.
const STRAIN_DESCRIPTIONS: Record<StrainLevel, string> = {
  Light: 'Minimal exertion is being put on the body, which encourages active recovery.',
  Moderate: 'Moderate exertion is being put on the body, which balances fitness gains and recovery.',
  High: 'Increased exertion which builds fitness gains, but makes it more difficult for your body to recover the next day.',
  'All out': 'Significant exertion which increases fitness gains, but puts your body at greater risk for injury or overtraining.',
};

// Same as above.
const RECOVERY_DESCRIPTIONS: Record<RecoveryLevel, string> = {
  Sufficient: 'Your body is well recovered and ready to perform. Whether it\'s at work or the gym, your body is signaling it can handle a strenuous day.',
  Adequate: 'Your body is maintaining health. You may not need rest and can still handle a moderately strenuous day.',
  Low: 'Your body is working hard to recover. Your body is signaling it needs an active rest day.',
};

// No official description for these, so I asked Whoop Coach to provide them.
const SLEEP_PERFORMANCE_DESCRIPTIONS: Record<SleepPerformanceLevel, string> = {
  Optimal: 'You\'re getting most or all of your Sleep Need with consistent timing, high efficiency, and low sleep stress that best support recovery and long-term health.',
  Sufficient: 'Your sleep is generally workable for day-to-day functioning but not fully optimized for recovery or long-term health.',
  Poor: 'You\'re meaningfully under-sleeping or your timing/quality is disrupted enough that it\'s likely to undermine your recovery and next-day performance.',
};

/**
 * Compute recovery level from score.
 *
 * Uses Whoop's official scale:
 * - Sufficient (Green): ≥67% - Well recovered, ready to perform
 * - Adequate (Yellow): 34-66% - Maintaining health, can handle moderate stress
 * - Low (Red): <34% - Working hard to recover, needs rest
 */
export function getRecoveryLevel(recoveryScore: number): RecoveryLevel {
  return recoveryScore >= 67
    ? 'Sufficient'
    : recoveryScore >= 34
      ? 'Adequate'
      : 'Low';
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
 * - Optimal: ≥85% - Got enough sleep to fully recover
 * - Sufficient: 70-84% - Got adequate sleep for basic recovery
 * - Poor: <70% - Did not get enough sleep, recovery impacted
 */
export function getSleepPerformanceLevel(sleepPerformancePercentage: number): SleepPerformanceLevel {
  return sleepPerformancePercentage >= 85
    ? 'Optimal'
    : sleepPerformancePercentage >= 70
      ? 'Sufficient'
      : 'Poor';
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
 * - Light (0-9): Minimal exertion, encourages active recovery
 * - Moderate (10-13): Balances fitness gains and recovery
 * - High (14-17): Builds fitness, harder to recover next day
 * - All out (18-21): Significant exertion, risk for injury/overtraining
 */
export function getStrainLevel(strainScore: number): StrainLevel {
  return strainScore < 10
    ? 'Light'
    : strainScore < 14
      ? 'Moderate'
      : strainScore < 18
        ? 'High'
        : 'All out';
}

/**
 * Get description for a strain level.
 */
export function getStrainLevelDescription(level: StrainLevel): string {
  return STRAIN_DESCRIPTIONS[level];
}
