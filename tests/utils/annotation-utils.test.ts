import { describe, it, expect } from 'vitest';
import { mergeAnnotations } from '../../src/utils/annotation-utils.js';
import type { Annotation } from '../../src/types/index.js';

describe('mergeAnnotations', () => {
  it('returns empty array when both inputs are empty', () => {
    expect(mergeAnnotations([], [])).toEqual([]);
  });

  it('keeps all Intervals.icu annotations and appends non-matching TrainerRoad ones, sorted by start_date', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: 'Conference', start_date: '2025-05-05', end_date: '2025-05-07' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('tr-1');
    expect(merged[1].id).toBe('icu-1');
  });

  it('drops a TrainerRoad annotation whose name matches an Intervals.icu one with overlapping dates (Intervals.icu wins)', () => {
    const icu: Annotation[] = [
      {
        id: 'icu-1',
        category: 'Holiday',
        name: 'Vacation',
        start_date: '2025-05-05',
        end_date: '2025-05-12',
        training_availability: 'Limited',
      },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: 'Vacation', start_date: '2025-05-08', end_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('icu-1');
    expect(merged[0].category).toBe('Holiday');
    expect(merged[0].training_availability).toBe('Limited');
  });

  it('matches names case-insensitively and ignores surrounding whitespace', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: '  cold  ', start_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('icu-1');
  });

  it('keeps a TrainerRoad annotation with the same name but no date overlap with the Intervals.icu one', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Sick', name: 'Cold', start_date: '2025-01-10', end_date: '2025-01-15' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: 'Cold', start_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(2);
    // Sorted by start_date: ICU (Jan) first, then TR (May)
    expect(merged.map((a) => a.id)).toEqual(['icu-1', 'tr-1']);
  });

  it('keeps a TrainerRoad annotation whose name does not match any Intervals.icu annotation, even with overlapping dates', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: 'Travel', start_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(2);
  });

  it('keeps a TrainerRoad annotation with no name (cannot be deduped by name match)', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', start_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(2);
  });

  it('does not match an Intervals.icu annotation that has no name against a TrainerRoad annotation', () => {
    const icu: Annotation[] = [
      { id: 'icu-1', category: 'Note', start_date: '2025-05-10' },
    ];
    const tr: Annotation[] = [
      { id: 'tr-1', category: 'Note', name: 'Travel', start_date: '2025-05-10' },
    ];

    const merged = mergeAnnotations(icu, tr);

    expect(merged).toHaveLength(2);
  });

  describe('category-based dedup (Sick/Injured/Holiday)', () => {
    it('drops a TR Sick annotation when ICU has an overlapping Sick annotation, even if names differ', () => {
      const icu: Annotation[] = [
        {
          id: 'icu-1',
          category: 'Sick',
          name: 'Sick - flu',
          start_date: '2025-05-08',
          end_date: '2025-05-12',
          training_availability: 'Unavailable',
        },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('icu-1');
      expect(merged[0].training_availability).toBe('Unavailable');
    });

    it('drops a TR Holiday annotation when ICU has an overlapping Holiday annotation', () => {
      const icu: Annotation[] = [
        {
          id: 'icu-1',
          category: 'Holiday',
          name: 'PTO',
          start_date: '2025-07-01',
          end_date: '2025-07-10',
        },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Holiday', name: 'Italy trip', start_date: '2025-07-05', end_date: '2025-07-08' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('icu-1');
    });

    it('drops a TR Injured annotation when ICU has an overlapping Injured annotation', () => {
      const icu: Annotation[] = [
        { id: 'icu-1', category: 'Injured', name: 'Achilles', start_date: '2025-05-10' },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Injured', name: 'Tendon flare', start_date: '2025-05-10' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('icu-1');
    });

    it('keeps a TR Sick annotation when ICU has only a Holiday on the same day (different categories)', () => {
      const icu: Annotation[] = [
        { id: 'icu-1', category: 'Holiday', name: 'PTO', start_date: '2025-05-10' },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(2);
    });

    it('keeps a TR Sick annotation when ICU has a Sick annotation with no date overlap', () => {
      const icu: Annotation[] = [
        { id: 'icu-1', category: 'Sick', name: 'Flu', start_date: '2025-01-10', end_date: '2025-01-15' },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Sick', name: 'Cold', start_date: '2025-05-10' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(2);
    });

    it('does not require a TR Sick/Injured/Holiday annotation to have a name to be deduped', () => {
      const icu: Annotation[] = [
        { id: 'icu-1', category: 'Sick', name: 'Flu', start_date: '2025-05-10' },
      ];
      const tr: Annotation[] = [
        { id: 'tr-1', category: 'Sick', start_date: '2025-05-10' },
      ];

      const merged = mergeAnnotations(icu, tr);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('icu-1');
    });
  });
});
