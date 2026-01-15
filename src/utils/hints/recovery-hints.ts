/**
 * Hint generators for recovery-related tools.
 * These hints guide the LLM on what other tools to call for context.
 */

import type { HintGenerator } from '../hints.js';
import type { DailySummary } from '../../types/index.js';

/**
 * Hint for correlating recovery with historical trends.
 * Guides LLM to check historical recovery patterns.
 */
export const recoveryTrendsHint: HintGenerator<DailySummary> = (data) => {
  const recovery = data.whoop.recovery;
  if (!recovery) return undefined;

  return [
    `For historical context, use get_recovery_trends to see how today's recovery compares to recent patterns.`,
  ];
};

/**
 * Combined hint generators for recovery data.
 */
export const recoveryHints: HintGenerator<DailySummary>[] = [
  recoveryTrendsHint,
];
