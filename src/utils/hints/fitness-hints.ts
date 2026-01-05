/**
 * Hint generators for fitness and training load tools.
 * These hints guide the LLM on what other tools to call for deeper analysis.
 */

import type { HintGenerator } from '../hints.js';
import type {
  DailySummary,
  PowerCurvesResponse,
  PaceCurvesResponse,
} from '../../types/index.js';

/**
 * Hint for drilling into daily summary fitness data.
 * Guides LLM on which tools can provide more detail on training load.
 */
export const dailySummaryFitnessHint: HintGenerator<DailySummary> = (data) => {
  if (data.fitness) {
    return `For training load trends over time, use get_training_load_trends to see CTL/ATL/TSB progression.`;
  }
  return undefined;
};

/**
 * Hint for drilling into daily summary recovery data.
 * Guides LLM on which tools can provide historical recovery context.
 */
export const dailySummaryRecoveryHint: HintGenerator<DailySummary> = (data) => {
  if (data.whoop.recovery) {
    return `For historical context, use get_recovery_trends to see how today's recovery compares to recent patterns.`;
  }
  return undefined;
};

/**
 * Hint for power curve analysis.
 * Guides LLM to check settings if there are improvements.
 */
export const powerCurveProgressHint: HintGenerator<PowerCurvesResponse> = (data) => {
  if (!data.comparison) {
    return (
      `To compare power curves between periods, call this tool again with compare_to_oldest and ` +
      `compare_to_newest parameters to see progress over time.`
    );
  }

  const improvements = data.comparison.changes.filter((c) => c.improved && c.change_percent >= 3);
  if (improvements.length > 0) {
    return (
      `Significant power improvements detected. Use get_sports_settings with sport='cycling' to check ` +
      `if FTP and power zones should be updated based on these improvements.`
    );
  }

  return undefined;
};

/**
 * Hint for pace curve analysis.
 * Guides LLM to check settings if there are improvements.
 */
export const paceCurveProgressHint: HintGenerator<PaceCurvesResponse> = (data) => {
  if (!data.comparison) {
    return (
      `To compare pace curves between periods, call this tool again with compare_to_oldest and ` +
      `compare_to_newest parameters to see progress over time.`
    );
  }

  const improvements = data.comparison.changes.filter((c) => c.improved && c.change_percent >= 3);
  if (improvements.length > 0) {
    return (
      `Significant pace improvements detected. Use get_sports_settings with sport='running' to check ` +
      `if pace zones should be updated based on these improvements.`
    );
  }

  return undefined;
};

/**
 * Combined hint generators for daily summary data.
 */
export const dailySummaryHints: HintGenerator<DailySummary>[] = [
  dailySummaryFitnessHint,
  dailySummaryRecoveryHint,
];
