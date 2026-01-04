/**
 * Hint generators for recovery-related tools.
 */

import type { HintGenerator } from '../hints.js';
import type {
  TodaysRecoveryResponse,
  DailySummary,
} from '../../types/index.js';

/**
 * Hint for low recovery suggesting workout modifications.
 */
export const lowRecoveryHint: HintGenerator<TodaysRecoveryResponse> = (data) => {
  const recovery = data.whoop.recovery;
  if (!recovery || recovery.recovery_score === undefined) return undefined;

  if (recovery.recovery_score < 33) {
    return (
      `Recovery score is low (${recovery.recovery_score}%). Consider suggesting ` +
      `reduced training intensity or rest day. Check get_todays_planned_workouts ` +
      `to assess if planned workouts should be modified.`
    );
  }

  return undefined;
};

/**
 * Hint for high recovery suggesting opportunity for hard training.
 */
export const highRecoveryHint: HintGenerator<TodaysRecoveryResponse> = (data) => {
  const recovery = data.whoop.recovery;
  if (!recovery || recovery.recovery_score === undefined) return undefined;

  if (recovery.recovery_score >= 67) {
    return (
      `Recovery score is high (${recovery.recovery_score}%). This may be a good day ` +
      `for a harder training session. Check get_todays_planned_workouts to see what's scheduled.`
    );
  }

  return undefined;
};

/**
 * Hint for poor sleep quality based on sleep performance.
 */
export const poorSleepHint: HintGenerator<TodaysRecoveryResponse> = (data) => {
  const sleep = data.whoop.sleep;
  if (!sleep) return undefined;

  // Check for poor sleep performance (less than 70%)
  if (sleep.sleep_performance_percentage < 70) {
    return (
      `Sleep performance was only ${sleep.sleep_performance_percentage.toFixed(0)}%. ` +
      `This may affect performance and recovery. Consider lighter training today.`
    );
  }

  // Check for poor sleep efficiency
  if (sleep.sleep_efficiency_percentage !== undefined && sleep.sleep_efficiency_percentage < 70) {
    return (
      `Sleep efficiency was ${sleep.sleep_efficiency_percentage.toFixed(0)}%. Poor sleep quality may ` +
      `affect performance. Consider adjusting training intensity.`
    );
  }

  return undefined;
};

/**
 * Hint for low HRV based on daily summary.
 * Note: We can only compare to thresholds since baseline is not exposed in the type.
 */
export const hrvHint: HintGenerator<DailySummary> = (data) => {
  const recovery = data.whoop.recovery;
  if (!recovery?.hrv_rmssd) return undefined;

  // Very low HRV might indicate stress or incomplete recovery
  // This is a general heuristic - actual interpretation depends on individual baseline
  if (recovery.hrv_rmssd < 30) {
    return (
      `HRV is quite low (${recovery.hrv_rmssd.toFixed(0)}ms). Consider fetching get_recovery_trends ` +
      `to understand if this is a pattern or one-off.`
    );
  }

  return undefined;
};

/**
 * Combined hint generators for recovery data.
 */
export const recoveryHints: HintGenerator<TodaysRecoveryResponse>[] = [
  lowRecoveryHint,
  highRecoveryHint,
  poorSleepHint,
];
