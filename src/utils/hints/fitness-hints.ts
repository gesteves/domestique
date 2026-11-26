/**
 * Hint generators for fitness and training load tools.
 * These hints guide the LLM on what other tools to call for deeper analysis.
 */

import type { HintGenerator } from '../hints.js';
import type {
  PowerCurvesResponse,
  PaceCurvesResponse,
} from '../../types/index.js';

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

  const improvements = data.comparison.changes.filter((c) => c.improved && parseFloat(c.change_percent) >= 3);
  if (improvements.length > 0) {
    return (
      `Significant power improvements detected. Use get_sports_settings with sports=['cycling'] to check ` +
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

  // For pace, an improvement is a *faster* time, so change_percent is
  // negative; compare its magnitude.
  const improvements = data.comparison.changes.filter(
    (c) => c.improved && Math.abs(parseFloat(c.change_percent)) >= 3
  );
  if (improvements.length > 0) {
    const sport = data.sport === 'swimming' ? 'swimming' : 'running';
    return (
      `Significant pace improvements detected. Use get_sports_settings with sports=['${sport}'] to check ` +
      `if pace zones should be updated based on these improvements.`
    );
  }

  return undefined;
};
