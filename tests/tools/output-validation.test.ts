import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/index.js';

/**
 * End-to-end output check: run real handlers (with mocked clients) through the
 * full response wrapper — date formatting, hint injection, null stripping —
 * and validate the resulting structuredContent against the tool's declared
 * outputSchema, the same way the SDK does. The structural conformance test
 * only inspects schemas; this one catches handler/schema drift.
 */

const today = '2024-12-15';

const plannedTr = {
  id: 'tr-1',
  scheduled_for: `${today}T00:00:00`,
  name: 'Base Run',
  expected_duration: '0:45:00',
  sport: 'Running',
  source: 'trainerroad',
};

const completed = {
  id: 'i1',
  start_time: `${today}T07:00:00-07:00`,
  activity_type: 'Cycling',
  name: 'Ride',
  duration: '1:00:26',
  tss: 41,
  intensity_factor: 0.64,
  hr_zones: [{ name: 'Recovery', low_hr: '0 bpm', high_hr: '138 bpm', time_in_zone: '1:00:14' }],
  power_zones: [{ name: 'Endurance', low_pct: '55%', high_pct: '75%', low_power: '154 W', high_power: '210 W', time_in_zone: '0:53:57' }],
  sweet_spot_time: '0:00:04',
  hr_decoupling: '-2.2%',
  source: 'intervals.icu',
  intervals_icu_url: 'https://intervals.icu/activities/i1',
};

vi.mock('../../src/clients/intervals.js', () => ({
  IntervalsClient: vi.fn().mockImplementation(function () {
    return {
      getAthleteTimezone: vi.fn().mockResolvedValue('America/Denver'),
      getUnitPreferences: vi.fn().mockResolvedValue({ system: 'metric', weight: 'kg', temperature: 'celsius' }),
      getActivities: vi.fn().mockResolvedValue([completed]),
      getPlannedEvents: vi.fn().mockResolvedValue([]),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getRaces: vi.fn().mockResolvedValue([]),
      getTodayFitness: vi.fn().mockResolvedValue({ date: today, ctl: 65.8, atl: 63.3, tsb: 2.5, ramp_rate: 0, ctl_load: 0, atl_load: 0 }),
      getTodayWellness: vi.fn().mockResolvedValue({ resting_hr: '51 bpm', sleep_quality: '2 - Good', sources: { resting_hr: 'garmin' } }),
      getEnabledWeatherLocations: vi.fn().mockResolvedValue([]),
      getAthleteProfile: vi.fn().mockResolvedValue({ id: 'i1', unit_preferences: { system: 'metric' } }),
      getTrainingLoadTrends: vi.fn().mockResolvedValue({
        period: { start_date: '2024-12-10', end_date: today, days: 6 },
        sport: 'all',
        summary: { current_ctl: 65.8, current_atl: 63.3, current_tsb: 2.5, ctl_trend: 'stable', avg_ramp_rate: 2.2, peak_ctl: 67.4, peak_ctl_date: '2024-12-12', acwr: 0.96, acwr_status: 'optimal' },
        data: [{ date: today, ctl: 65.8, atl: 63.3, tsb: 2.5, ramp_rate: 0, ctl_load: 0, atl_load: 0 }],
      }),
    };
  }),
}));

vi.mock('../../src/clients/whoop.js', () => ({
  WhoopClient: vi.fn().mockImplementation(function () {
    return {
      setTimezoneGetter: vi.fn(),
      // Recovery not scored yet, sleep present → data_status.whoop_recovery = no_data
      getTodayRecovery: vi.fn().mockResolvedValue({
        recovery: null,
        sleep: { sleep_performance: '84%', sleep_start: '2024-12-14T21:55:00-07:00', sleep_end: `${today}T06:23:00-07:00` },
      }),
      getTodayStrain: vi.fn().mockResolvedValue({ date: today, strain_score: 0.2, activities: [] }),
      getWorkouts: vi.fn().mockResolvedValue([]),
      getBodyMeasurements: vi.fn().mockResolvedValue({ height: '171 cm', weight: '76.3 kg', max_heart_rate: '190 bpm' }),
      getStrainData: vi.fn().mockResolvedValue([{ date: today, strain_score: 7.3, activities: [] }]),
      getRecoveries: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('../../src/clients/trainerroad.js', () => ({
  TrainerRoadClient: vi.fn().mockImplementation(function () {
    return {
      getPlannedWorkouts: vi.fn().mockResolvedValue([plannedTr]),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getTrainingPhaseStarts: vi.fn().mockResolvedValue([]),
      getCurrentTrainingPhase: vi.fn().mockResolvedValue(null),
      getUpcomingRaces: vi.fn().mockResolvedValue([]),
    };
  }),
}));

interface Registered {
  config: { outputSchema: z.ZodType };
  handler: (args: unknown) => Promise<{ structuredContent: Record<string, unknown>; isError?: boolean }>;
}

describe('tool output validates against its outputSchema', () => {
  const tools = new Map<string, Registered>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
    tools.clear();
    const server = {
      registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
        tools.set(name, { config, handler });
      },
    };
    const registry = new ToolRegistry({
      intervals: { apiKey: 'k', athleteId: 'i1' },
      whoop: { accessToken: 'a', refreshToken: 'r', clientId: 'c', clientSecret: 's' },
      trainerroad: { calendarUrl: 'https://example.com/cal.ics' },
    });
    registry.registerTools(server as unknown as Parameters<typeof registry.registerTools>[0]);
  });

  async function call(name: string, args: unknown = {}) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    const response = await tool.handler(args);
    expect(response.isError).not.toBe(true);
    const parsed = tool.config.outputSchema.safeParse(response.structuredContent);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
    return response.structuredContent;
  }

  it('get_todays_summary', async () => {
    const out = await call('get_todays_summary');
    expect(Object.keys(out).slice(0, 6)).toEqual(['current_time', 'overview', 'readiness', 'load', 'workouts', 'weather']);
    expect(out.data_status).toMatchObject({ whoop_recovery: 'no_data', weather: 'not_configured' });
    expect((out.overview as { workouts: Record<string, number> }).workouts).toMatchObject({ planned: 1, planned_without_tss: 1 });
  });

  it('get_todays_activities', async () => {
    const out = await call('get_todays_activities');
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['current_time', 'overview', 'workouts']));
  });

  it('get_athlete_profile', async () => {
    const out = await call('get_athlete_profile');
    expect(out.whoop_body_measurements).toMatchObject({ max_heart_rate: '190 bpm' });
  });

  it('get_training_load_trends', async () => {
    const out = await call('get_training_load_trends', { oldest: '2024-12-10' });
    expect(Object.keys(out)).toEqual(['period', 'sport', 'summary', 'data']);
  });

  it('get_strain_history', async () => {
    await call('get_strain_history', { oldest: '2024-12-10' });
  });

  it('get_recovery_trends', async () => {
    const out = await call('get_recovery_trends', { oldest: '2024-12-10' });
    expect(Object.keys(out)).toEqual(['period', 'summary', 'data']);
  });

  it('get_activity_history', async () => {
    await call('get_activity_history', { oldest: '2024-12-01', newest: '2024-12-14' });
  });

  it('get_upcoming_activities', async () => {
    await call('get_upcoming_activities', {});
  });
});
