import { describe, it, expect } from 'vitest';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

const client = new TrainerRoadClient({ calendarUrl: 'https://example.test/ics' }) as unknown as {
  parseDescription(description?: string): { tss?: number; if?: number; duration?: number };
};

describe('TrainerRoadClient.parseDescription IF extraction', () => {
  it('parses the standard TrainerRoad header', () => {
    expect(client.parseDescription('TSS 81, IF 0.64, kJ(Cal) 1263.')).toMatchObject({ tss: 81, if: 0.64 });
  });

  it('keeps an IF above 1.0 as a ratio', () => {
    expect(client.parseDescription('TSS 60, IF 1.05, kJ(Cal) 500.').if).toBe(1.05);
  });

  it('converts a percent IF to a ratio', () => {
    expect(client.parseDescription('Intensity Factor: 85%').if).toBe(0.85);
  });

  it('does not parse lowercase "if" in prose as an IF value', () => {
    expect(client.parseDescription('Run easy. Stop if 3 intervals feel too hard.').if).toBeUndefined();
  });
});

describe('TrainerRoadClient.normalizeAnnotation end dates', () => {
  const tr = new TrainerRoadClient({ calendarUrl: 'https://example.test/ics' }) as unknown as {
    normalizeAnnotation(
      event: { uid: string; start: Date; end: Date; summary: string; description?: string; dateType: string },
      timezone?: string
    ): { start_date: string; end_date?: string } | null;
  };

  it('treats a DATE-TIME end at local midnight as exclusive', () => {
    const result = tr.normalizeAnnotation(
      {
        uid: 'a',
        summary: 'Travel',
        dateType: 'date-time',
        start: new Date('2026-11-25T16:00:00Z'), // 09:00 MST
        end: new Date('2026-11-27T07:00:00Z'),   // 00:00 MST Nov 27
      },
      'America/Denver'
    );
    expect(result).toMatchObject({ start_date: '2026-11-25', end_date: '2026-11-26' });
  });

  it('keeps the end day when a DATE-TIME event ends during it', () => {
    const result = tr.normalizeAnnotation(
      {
        uid: 'b',
        summary: 'Travel',
        dateType: 'date-time',
        start: new Date('2026-11-25T16:00:00Z'),
        end: new Date('2026-11-27T19:00:00Z'), // 12:00 MST Nov 27
      },
      'America/Denver'
    );
    expect(result).toMatchObject({ start_date: '2026-11-25', end_date: '2026-11-27' });
  });

  it('does not produce an end before the start for a short event ending at midnight', () => {
    const result = tr.normalizeAnnotation(
      {
        uid: 'c',
        summary: 'Late note',
        dateType: 'date-time',
        start: new Date('2026-11-26T05:00:00Z'), // 22:00 MST Nov 25
        end: new Date('2026-11-26T07:00:00Z'),   // 00:00 MST Nov 26
      },
      'America/Denver'
    );
    expect(result?.start_date).toBe('2026-11-25');
    expect(result?.end_date).toBeUndefined();
  });
});

describe('TrainerRoadClient race-leg exclusion', () => {
  type Ev = { uid: string; start: Date; end: Date; summary: string; dateType: string };
  const tr = new TrainerRoadClient({ calendarUrl: 'https://example.test/ics' }) as unknown as {
    findRaceEventNames(events: Ev[]): Set<string>;
    isWorkout(event: Ev, raceEventNames?: Set<string>): boolean;
  };
  // node-ical parses DATE values as local midnight.
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  it('excludes a same-named leg on the race day', () => {
    const race: Ev = { uid: 'r', summary: 'Escape from Alcatraz', dateType: 'date', start: day(2026, 6, 7), end: day(2026, 6, 8) };
    const leg: Ev = { uid: 'l', summary: '0:45 - Escape from Alcatraz', dateType: 'date', start: day(2026, 6, 7), end: day(2026, 6, 8) };
    expect(tr.isWorkout(leg, tr.findRaceEventNames([race, leg]))).toBe(false);
  });

  it('keeps a same-named workout on a different day', () => {
    const note: Ev = { uid: 'n', summary: 'Brick', dateType: 'date', start: day(2026, 6, 1), end: day(2026, 6, 2) };
    const workout: Ev = { uid: 'w', summary: '1:00 - Brick', dateType: 'date', start: day(2026, 6, 2), end: day(2026, 6, 3) };
    expect(tr.isWorkout(workout, tr.findRaceEventNames([note, workout]))).toBe(true);
  });
});
