/**
 * Hint generators for fitness and training load tools.
 */

import type { HintGenerator } from '../hints.js';
import type {
  DailySummary,
  PowerCurvesResponse,
  PaceCurvesResponse,
} from '../../types/index.js';

/**
 * Hint for high training ramp rate.
 */
export const trainingLoadRiskHint: HintGenerator<DailySummary> = (data) => {
  const fitness = data.fitness;
  if (!fitness) return undefined;

  // Check ramp rate - risky if > 8
  if (fitness.ramp_rate !== undefined && fitness.ramp_rate > 8) {
    return (
      `Ramp rate is ${fitness.ramp_rate.toFixed(1)} TSS/week, which is aggressive. ` +
      `Consider moderating the training increase to reduce overtraining risk.`
    );
  }

  return undefined;
};

/**
 * Hint for low form (TSB) suggesting rest.
 */
export const lowFormHint: HintGenerator<DailySummary> = (data) => {
  const fitness = data.fitness;
  if (!fitness?.tsb) return undefined;

  if (fitness.tsb < -30) {
    return (
      `Form (TSB) is very low at ${fitness.tsb.toFixed(0)}. The athlete may be ` +
      `significantly fatigued. Consider reducing training load or scheduling rest.`
    );
  }

  return undefined;
};

/**
 * Hint for high form (good taper) before a race.
 */
export const raceReadinessHint: HintGenerator<DailySummary> = (data) => {
  const fitness = data.fitness;
  const race = data.scheduled_race;

  if (!fitness?.tsb || !race) return undefined;

  if (fitness.tsb >= 10 && fitness.tsb <= 25) {
    return (
      `Form (TSB) is ${fitness.tsb.toFixed(0)}, which is in the optimal race range (10-25). ` +
      `The athlete appears well-tapered for ${race.name}.`
    );
  } else if (fitness.tsb < 0 && race) {
    return (
      `Form (TSB) is ${fitness.tsb.toFixed(0)}, which is negative. ` +
      `The athlete may not be fully recovered for ${race.name}. ` +
      `Consider additional rest before the race.`
    );
  }

  return undefined;
};

/**
 * Hint for power curve improvements.
 */
export const powerCurveProgressHint: HintGenerator<PowerCurvesResponse> = (data) => {
  if (!data.comparison) return undefined;

  const improvements = data.comparison.changes.filter((c) => c.improved);
  if (improvements.length === 0) return undefined;

  const significantImprovements = improvements.filter(
    (c) => c.change_percent >= 3
  );

  if (significantImprovements.length > 0) {
    const labels = significantImprovements.map((c) => c.duration_label).join(', ');
    return (
      `Significant power improvements detected at ${labels}. ` +
      `Consider updating FTP via get_sports_settings to see if zones need adjustment.`
    );
  }

  return undefined;
};

/**
 * Hint for pace curve improvements.
 */
export const paceCurveProgressHint: HintGenerator<PaceCurvesResponse> = (data) => {
  if (!data.comparison) return undefined;

  const improvements = data.comparison.changes.filter((c) => c.improved);
  if (improvements.length === 0) return undefined;

  const significantImprovements = improvements.filter(
    (c) => c.change_percent >= 3
  );

  if (significantImprovements.length > 0) {
    const labels = significantImprovements.map((c) => c.distance_label).join(', ');
    return (
      `Significant pace improvements detected at ${labels}. ` +
      `Consider updating pace zones via get_sports_settings to see if training zones need adjustment.`
    );
  }

  return undefined;
};

/**
 * Combined hint generators for daily summary fitness data.
 */
export const dailySummaryFitnessHints: HintGenerator<DailySummary>[] = [
  trainingLoadRiskHint,
  lowFormHint,
  raceReadinessHint,
];
