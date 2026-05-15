/**
 * Resolves the Claude model used by the annotation and race-priority
 * classifiers. Reads `ANTHROPIC_CLASSIFIER_MODEL` per call so a process
 * restart isn't required to pick up an env change in dev.
 */

export const DEFAULT_CLASSIFIER_MODEL = 'claude-haiku-4-5';

export function getClassifierModel(): string {
  return process.env.ANTHROPIC_CLASSIFIER_MODEL?.trim() || DEFAULT_CLASSIFIER_MODEL;
}

/**
 * Resolves the Claude model used by the activity-description generator
 * (Whoop webhook → Strava-ready descriptions). Defaults to Sonnet for prose
 * quality; override via `ANTHROPIC_DESCRIPTION_MODEL`.
 */

export const DEFAULT_DESCRIPTION_MODEL = 'claude-sonnet-4-6';

export function getDescriptionModel(): string {
  return process.env.ANTHROPIC_DESCRIPTION_MODEL?.trim() || DEFAULT_DESCRIPTION_MODEL;
}

/**
 * Resolves the Claude model used by the workout-structure converter
 * (plain-language `structure` → Intervals.icu workout-doc syntax for
 * `create_workout` / `update_workout`). Defaults to Sonnet for syntax
 * fidelity; override via `ANTHROPIC_WORKOUT_MODEL`.
 */

export const DEFAULT_WORKOUT_MODEL = 'claude-sonnet-4-6';

export function getWorkoutModel(): string {
  return process.env.ANTHROPIC_WORKOUT_MODEL?.trim() || DEFAULT_WORKOUT_MODEL;
}
