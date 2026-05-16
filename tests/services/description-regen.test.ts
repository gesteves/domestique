import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  regenerateDayDescriptions,
  type DescriptionRegenDeps,
} from '../../src/services/description-regen.js';
import { _resetDescriptionClientForTesting } from '../../src/utils/activity-description.js';

const METRIC_PREFS = {
  system: 'metric',
  weight: 'kg',
  temperature: 'celsius',
  wind: 'kmh',
  precipitation: 'mm',
  height: 'cm',
};

function makeIntervals(overrides: Record<string, unknown> = {}) {
  return {
    getAthleteTimezone: vi.fn().mockResolvedValue('UTC'),
    getActivities: vi.fn().mockResolvedValue([]),
    getActivity: vi.fn(),
    getUnitPreferences: vi.fn().mockResolvedValue(METRIC_PREFS),
    updateActivity: vi.fn().mockResolvedValue(undefined),
    getCoreHeatAdaptationScore: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeDeps(
  intervals: ReturnType<typeof makeIntervals>,
  whoop: unknown = null,
  trainerroad: unknown = null
): DescriptionRegenDeps {
  return {
    intervals: intervals as never,
    whoop: whoop as never,
    trainerroad: trainerroad as never,
  };
}

describe('regenerateDayDescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();
  });

  it('regenerates eligible activities, matches Whoop, and skips pool/unavailable', async () => {
    const intervals = makeIntervals({
      getActivities: vi.fn().mockResolvedValue([
        {
          id: 'run-1',
          start_time: '2024-12-15T10:00:00+00:00',
          activity_type: 'Running',
          source: 'intervals.icu',
        },
        {
          id: 'strava-1',
          start_time: '2024-12-15T12:00:00+00:00',
          activity_type: 'Running',
          unavailable: true,
        },
        {
          id: 'pool-1',
          start_time: '2024-12-15T07:00:00+00:00',
          activity_type: 'Swimming',
          pool_length: '25 m',
        },
      ]),
      getActivity: vi.fn().mockResolvedValue({
        id: 'run-1',
        start_time: '2024-12-15T10:00:00+00:00',
        activity_type: 'Running',
        source: 'intervals.icu',
      }),
    });
    const whoop = {
      getWorkouts: vi.fn().mockResolvedValue([
        {
          id: 'w-1',
          activity_type: 'Running',
          start_time: '2024-12-15T10:01:00+00:00',
          end_time: '2024-12-15T11:00:00+00:00',
          duration: '1:00:00',
          strain_score: 13.5,
        },
      ]),
    };

    const result = await regenerateDayDescriptions('2024-12-15', makeDeps(intervals, whoop));

    expect(result.date).toBe('2024-12-15');
    expect(result.regenerated).toEqual(['run-1']);
    expect(result.skipped).toEqual(['strava-1', 'pool-1']);
    expect(whoop.getWorkouts).toHaveBeenCalledWith('2024-12-15', '2024-12-15');
    expect(intervals.updateActivity).toHaveBeenCalledTimes(1);
    const [id, body] = intervals.updateActivity.mock.calls[0];
    expect(id).toBe('run-1');
    expect(body.description).toContain('🔥 Whoop strain 13.5');
  });

  it('defaults to today in the athlete timezone when no date is given', async () => {
    const intervals = makeIntervals();
    const deps = makeDeps(intervals);

    const result = await regenerateDayDescriptions(null, deps);

    expect(intervals.getAthleteTimezone).toHaveBeenCalled();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(intervals.getActivities).toHaveBeenCalledWith(
      result.date,
      result.date,
      undefined,
      { skipExpensiveCalls: true }
    );
  });

  it('composes a description without a Whoop block when whoop is null', async () => {
    const intervals = makeIntervals({
      getActivities: vi.fn().mockResolvedValue([
        {
          id: 'ride-1',
          start_time: '2024-12-15T10:00:00+00:00',
          activity_type: 'Cycling',
          source: 'intervals.icu',
        },
      ]),
      getActivity: vi.fn().mockResolvedValue({
        id: 'ride-1',
        start_time: '2024-12-15T10:00:00+00:00',
        activity_type: 'Cycling',
        source: 'intervals.icu',
        average_power: '200 W',
        tss: 98,
      }),
    });

    const result = await regenerateDayDescriptions('2024-12-15', makeDeps(intervals, null));

    expect(result.regenerated).toEqual(['ride-1']);
    const [, body] = intervals.updateActivity.mock.calls[0];
    expect(body.description).toContain('⚡️');
    expect(body.description).not.toContain('🔥');
  });

  it('isolates per-activity failures so one bad activity does not abort the rest', async () => {
    const intervals = makeIntervals({
      getActivities: vi.fn().mockResolvedValue([
        { id: 'bad', start_time: '2024-12-15T08:00:00+00:00', activity_type: 'Cycling' },
        { id: 'good', start_time: '2024-12-15T10:00:00+00:00', activity_type: 'Cycling' },
      ]),
      getActivity: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          id: 'good',
          start_time: '2024-12-15T10:00:00+00:00',
          activity_type: 'Cycling',
          average_power: '200 W',
          tss: 98,
        }),
    });

    const result = await regenerateDayDescriptions('2024-12-15', makeDeps(intervals));

    expect(result.regenerated).toEqual(['good']);
    expect(intervals.updateActivity).toHaveBeenCalledTimes(1);
    expect(intervals.updateActivity.mock.calls[0][0]).toBe('good');
  });
});
