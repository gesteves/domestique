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
});
