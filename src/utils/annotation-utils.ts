import type { Annotation } from '../types/index.js';

/**
 * Merge annotations from Intervals.icu and TrainerRoad, deduplicating
 * TrainerRoad entries against Intervals.icu when both share a name
 * (case-insensitive) and have overlapping date ranges. Intervals.icu wins
 * because it carries category and training_availability metadata that
 * TrainerRoad does not. Output is sorted by start_date.
 */
export function mergeAnnotations(
  intervalsAnnotations: Annotation[],
  trainerroadAnnotations: Annotation[]
): Annotation[] {
  const dedupedTr = trainerroadAnnotations.filter((tr) => {
    const trName = tr.name?.trim().toLowerCase();
    if (!trName) return true;
    const trEnd = tr.end_date ?? tr.start_date;
    return !intervalsAnnotations.some((icu) => {
      const icuName = icu.name?.trim().toLowerCase();
      if (!icuName || icuName !== trName) return false;
      const icuEnd = icu.end_date ?? icu.start_date;
      return icu.start_date <= trEnd && icuEnd >= tr.start_date;
    });
  });
  return [...intervalsAnnotations, ...dedupedTr].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );
}
