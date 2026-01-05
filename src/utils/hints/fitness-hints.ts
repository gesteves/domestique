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
 * Hint for drilling into daily summary data.
 * Guides LLM on which tools can provide more detail on specific areas.
 */
export const dailySummaryDrilldownHint: HintGenerator<DailySummary> = (data) => {
  const hints: string[] = [];

  if (data.completed_workouts.length > 0) {
    const workoutIds = data.completed_workouts.map((w) => w.id).join(', ');
    hints.push(
      `For full workout analysis, use get_workout_details with activity_id to get intervals, notes, weather, and zones. Available IDs: ${workoutIds}`
    );
    hints.push(
      `For specific data only, use get_workout_intervals, get_workout_notes, or get_workout_weather with activity_id.`
    );
  }

  if (data.fitness) {
    hints.push(
      `For training load trends over time, use get_training_load_trends to see CTL/ATL/TSB progression.`
    );
  }

  return hints.length > 0 ? hints : undefined;
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
 * Combined hint generators for daily summary fitness data.
 */
export const dailySummaryFitnessHints: HintGenerator<DailySummary>[] = [
  dailySummaryDrilldownHint,
];
