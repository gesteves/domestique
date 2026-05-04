import type { Annotation } from '../types/index.js';

/**
 * Merge annotations from Intervals.icu and TrainerRoad, deduplicating
 * TrainerRoad entries against Intervals.icu when both refer to the same
 * logical event. Intervals.icu wins because it carries category and
 * training_availability metadata that TrainerRoad does not. Output is sorted
 * by start_date.
 *
 * Deduplication strategy depends on the TrainerRoad annotation's category:
 *
 * - Sick / Injured / Holiday: a TR annotation is dropped if any Intervals.icu
 *   annotation has the same category and an overlapping date range. These
 *   categories are typically singular at a time (one illness, one trip), so
 *   category + overlap is a reliable signal that they describe the same
 *   event — even if the titles differ ("Cold" vs. "Sick - flu").
 * - Note: falls back to case-insensitive name match + date overlap. Notes are
 *   freeform and can legitimately coexist on the same day, so category alone
 *   would over-merge.
 *
 * Categorization of TR annotations into the right bucket happens in
 * `src/utils/annotation-categorizer.ts` (optional, requires ANTHROPIC_API_KEY).
 * When unavailable, all TR annotations carry category 'Note' and the legacy
 * name-based dedup path is used.
 */
export function mergeAnnotations(
  intervalsAnnotations: Annotation[],
  trainerroadAnnotations: Annotation[]
): Annotation[] {
  const dedupedTr = trainerroadAnnotations.filter((tr) => {
    const trEnd = tr.end_date ?? tr.start_date;

    if (tr.category === 'Note') {
      const trName = tr.name?.trim().toLowerCase();
      if (!trName) return true;
      return !intervalsAnnotations.some((icu) => {
        const icuName = icu.name?.trim().toLowerCase();
        if (!icuName || icuName !== trName) return false;
        const icuEnd = icu.end_date ?? icu.start_date;
        return icu.start_date <= trEnd && icuEnd >= tr.start_date;
      });
    }

    return !intervalsAnnotations.some((icu) => {
      if (icu.category !== tr.category) return false;
      const icuEnd = icu.end_date ?? icu.start_date;
      return icu.start_date <= trEnd && icuEnd >= tr.start_date;
    });
  });
  return [...intervalsAnnotations, ...dedupedTr].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );
}
