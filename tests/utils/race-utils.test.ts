import { describe, it, expect } from 'vitest';
import { mergeRaces } from '../../src/utils/race-utils.js';
import type { Race } from '../../src/types/index.js';

const icu = (overrides: Partial<Race> = {}): Race => ({
  scheduled_for: '2026-05-15T08:00:00-06:00',
  name: 'Boston Marathon',
  sport: 'Running',
  priority: 'A',
  ...overrides,
});

const tr = (overrides: Partial<Race> = {}): Race => ({
  scheduled_for: '2026-06-15T08:00:00-07:00',
  name: 'Escape from Alcatraz',
  sport: 'Triathlon',
  priority: 'A',
  ...overrides,
});

describe('mergeRaces', () => {
  it('concatenates non-overlapping ICU and TR sets', () => {
    const result = mergeRaces([icu()], [tr()]);
    expect(result.map((r) => r.name)).toEqual([
      'Boston Marathon',
      'Escape from Alcatraz',
    ]);
  });

  it('returns sorted by scheduled_for ascending', () => {
    const result = mergeRaces(
      [
        icu({ name: 'Late', scheduled_for: '2026-09-01T08:00:00-06:00' }),
        icu({ name: 'Early', scheduled_for: '2026-03-01T08:00:00-06:00' }),
      ],
      [tr({ name: 'Middle', scheduled_for: '2026-06-15T08:00:00-07:00' })]
    );
    expect(result.map((r) => r.name)).toEqual(['Early', 'Middle', 'Late']);
  });

  it('keeps the TR entry when it has sport=Triathlon (TR wins for tri)', () => {
    const trEntry = tr({
      name: 'Escape from Alcatraz',
      sport: 'Triathlon',
      priority: 'A',
      description: 'TR umbrella',
    });
    // Hypothetical conflicting ICU entry on the same date — same key shape.
    const icuEntry = icu({
      name: 'Escape from Alcatraz',
      sport: 'Triathlon' as Race['sport'],
      scheduled_for: trEntry.scheduled_for,
      description: 'ICU stub',
    });

    const result = mergeRaces([icuEntry], [trEntry]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('TR umbrella');
  });

  it('lets the ICU entry win for non-triathlon collisions', () => {
    const trEntry = tr({
      name: 'Boston Marathon',
      sport: 'Running',
      scheduled_for: '2026-05-15T08:00:00-06:00',
      description: 'TR fallback',
      priority: undefined,
    });
    const icuEntry = icu({
      name: 'Boston Marathon',
      sport: 'Running',
      scheduled_for: '2026-05-15T08:00:00-06:00',
      description: 'ICU canonical',
      priority: 'A',
    });

    const result = mergeRaces([icuEntry], [trEntry]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('ICU canonical');
    expect(result[0].priority).toBe('A');
  });

  it('treats different dates as distinct events even with the same name+sport', () => {
    const r2025 = icu({ scheduled_for: '2025-04-21T08:00:00-04:00' });
    const r2026 = icu({ scheduled_for: '2026-04-20T08:00:00-04:00' });

    const result = mergeRaces([r2025, r2026], []);
    expect(result).toHaveLength(2);
  });

  it('treats different sports as distinct events even with the same name+date', () => {
    // Contrived: two events sharing a name and a date but different sports
    // shouldn't collapse — each is its own entry.
    const a = icu({
      name: 'Spring Festival',
      sport: 'Running',
      scheduled_for: '2026-05-15T08:00:00-06:00',
    });
    const b = icu({
      name: 'Spring Festival',
      sport: 'Cycling',
      scheduled_for: '2026-05-15T08:00:00-06:00',
    });

    const result = mergeRaces([a, b], []);
    expect(result).toHaveLength(2);
  });

  it('normalizes name case and whitespace when computing the dedup key', () => {
    const trEntry = tr({
      name: '  boston marathon ',
      sport: 'Running',
      scheduled_for: '2026-05-15T08:00:00-06:00',
      description: 'TR',
    });
    const icuEntry = icu({
      name: 'Boston Marathon',
      sport: 'Running',
      scheduled_for: '2026-05-15T08:00:00-06:00',
      description: 'ICU',
      priority: 'A',
    });

    const result = mergeRaces([icuEntry], [trEntry]);
    expect(result).toHaveLength(1);
    // ICU wins for non-tri.
    expect(result[0].description).toBe('ICU');
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeRaces([], [])).toEqual([]);
  });
});
