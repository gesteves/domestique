/**
 * Hint generators for recovery-related tools.
 * These hints guide the LLM on what other tools to call for context.
 */

import type { HintGenerator } from '../hints.js';
import type { TodaysRecoveryResponse } from '../../types/index.js';

/**
 * Hint for correlating recovery with planned workouts.
 * Guides LLM to check what's planned and potentially suggest modifications.
 */
export const recoveryPlanningHint: HintGenerator<TodaysRecoveryResponse> = (data) => {
  const recovery = data.whoop.recovery;
  if (!recovery) return undefined;

  return (
    `To understand how this recovery data relates to today's training, use get_todays_planned_workouts ` +
    `to see what workouts are scheduled. For historical context, use get_recovery_trends to see ` +
    `how today's recovery compares to recent patterns.`
  );
};

/**
 * Combined hint generators for recovery data.
 */
export const recoveryHints: HintGenerator<TodaysRecoveryResponse>[] = [
  recoveryPlanningHint,
];
