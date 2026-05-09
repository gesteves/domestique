import type { Race } from '../types/index.js';

/**
 * Merge race lists from Intervals.icu and TrainerRoad.
 *
 * The two sources are complementary by design: ICU is the source of truth for
 * single-discipline races (where it carries native A/B/C priority via the
 * `category` field), and TrainerRoad is the source of truth for triathlons
 * (where the umbrella+leg pattern is the only available representation).
 * Collisions are rare in practice; this function exists primarily as a
 * safety net.
 *
 * Dedup key: normalized name + sport + date (the `YYYY-MM-DD` prefix of
 * `scheduled_for`). Two same-named races on different dates are different
 * events; two races with different sports on the same day are also distinct.
 *
 * Conflict winner:
 *   - If a TrainerRoad entry collides with an Intervals.icu entry AND the TR
 *     entry has `sport === 'Triathlon'`, the TR entry wins (TR is canonical
 *     for triathlons).
 *   - Otherwise the ICU entry wins (ICU is canonical for non-triathlons,
 *     and carries native priority).
 *
 * Output is sorted by `scheduled_for` ascending.
 */
export function mergeRaces(
  intervalsRaces: Race[],
  trainerroadRaces: Race[]
): Race[] {
  const byKey = new Map<string, Race>();

  for (const race of trainerroadRaces) {
    byKey.set(keyFor(race), race);
  }

  for (const icuRace of intervalsRaces) {
    const key = keyFor(icuRace);
    const existing = byKey.get(key);
    if (existing && existing.sport === 'Triathlon') {
      // TR wins for triathlons — keep the existing TR entry.
      continue;
    }
    // ICU wins for non-tri (and for any case with no collision).
    byKey.set(key, icuRace);
  }

  return [...byKey.values()].sort((a, b) =>
    a.scheduled_for.localeCompare(b.scheduled_for)
  );
}

function keyFor(race: Race): string {
  const name = race.name.trim().toLowerCase();
  const date = race.scheduled_for.slice(0, 10);
  return `${name}|${race.sport}|${date}`;
}
