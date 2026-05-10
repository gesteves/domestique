/**
 * Resolves the Claude model used by the annotation and race-priority
 * classifiers. Reads `ANTHROPIC_CLASSIFIER_MODEL` per call so a process
 * restart isn't required to pick up an env change in dev.
 */

export const DEFAULT_CLASSIFIER_MODEL = 'claude-haiku-4-5';

export function getClassifierModel(): string {
  return process.env.ANTHROPIC_CLASSIFIER_MODEL?.trim() || DEFAULT_CLASSIFIER_MODEL;
}
