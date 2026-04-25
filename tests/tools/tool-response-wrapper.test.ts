import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../../src/tools/index.js';
import { ApiError, DateParseError, IntervalsApiError } from '../../src/errors/index.js';

// Mock all clients
vi.mock('../../src/clients/intervals.js', () => ({
  IntervalsClient: vi.fn().mockImplementation(function () {
    return {
      getActivities: vi.fn().mockResolvedValue([]),
      getPlannedEvents: vi.fn().mockResolvedValue([]),
      getFitnessMetrics: vi.fn().mockResolvedValue([]),
      getTrainingLoadTrends: vi.fn().mockResolvedValue({ data: [], summary: {} }),
      getAthleteTimezone: vi.fn().mockResolvedValue('America/New_York'),
      getAthleteProfile: vi.fn().mockResolvedValue({ id: 'test', sports: [] }),
      getActivityIntervals: vi.fn().mockResolvedValue({ activity_id: 'test', intervals: [], groups: [] }),
      getSportSettingsForSport: vi.fn().mockResolvedValue({ sport: 'cycling', settings: {} }),
      getUnitPreferences: vi.fn().mockResolvedValue({ system: 'metric', weight: 'kg', temperature: 'celsius' }),
      getWellness: vi.fn().mockResolvedValue(null),
      getWellnessTrends: vi.fn().mockResolvedValue({ period_days: 7, start_date: '', end_date: '', data: [] }),
      setPlayedSongsGetter: vi.fn(),
    };
  }),
}));

vi.mock('../../src/clients/whoop.js', () => ({
  WhoopClient: vi.fn().mockImplementation(function () {
    return {
      getTodayRecovery: vi.fn().mockResolvedValue({ sleep: null, recovery: null }),
      getTodayStrain: vi.fn().mockResolvedValue(null),
      getStrainData: vi.fn().mockResolvedValue([]),
      getRecoveries: vi.fn().mockResolvedValue([]),
      getWorkouts: vi.fn().mockResolvedValue([]),
      getBodyMeasurements: vi.fn().mockResolvedValue(null),
      setTimezoneGetter: vi.fn(),
    };
  }),
  // Note: We don't mock WhoopApiError here because the tests use the real error classes
}));

vi.mock('../../src/clients/trainerroad.js', () => ({
  TrainerRoadClient: vi.fn().mockImplementation(function () {
    return {
      getTodayWorkouts: vi.fn().mockResolvedValue([]),
      getPlannedWorkouts: vi.fn().mockResolvedValue([]),
      getUpcomingWorkouts: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('../../src/clients/lastfm.js', () => ({
  LastFmClient: vi.fn().mockImplementation(function () {
    return {
      getPlayedSongsDuring: vi.fn().mockResolvedValue([]),
    };
  }),
}));

describe('Tool Response Wrapper', () => {
  let registry: ToolRegistry;
  let mockServer: { registerTool: ReturnType<typeof vi.fn> };
  let registeredHandlers: Map<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers = new Map();

    mockServer = {
      // registerTool takes (name, config, handler) instead of (name, description, schema, handler)
      registerTool: vi.fn().mockImplementation((name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => {
        registeredHandlers.set(name, handler);
      }),
    };

    registry = new ToolRegistry({
      intervals: { apiKey: 'test', athleteId: 'test' },
      whoop: {
        accessToken: 'test',
        refreshToken: 'test',
        clientId: 'test',
        clientSecret: 'test',
      },
      trainerroad: { calendarUrl: 'https://test.com' },
      lastfm: { username: 'test', apiKey: 'test' },
    });

    registry.registerTools(mockServer as unknown as Parameters<typeof registry.registerTools>[0]);
  });

  describe('response format', () => {
    it('returns the handler payload as structuredContent (no envelope)', async () => {
      const handler = registeredHandlers.get('get_athlete_profile');
      expect(handler).toBeDefined();

      const result = (await handler!({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: Record<string, unknown>;
      };

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      // structuredContent IS the response payload (the mocked athlete profile)
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.id).toBe('test');
      // No leftover envelope keys
      expect(result.structuredContent).not.toHaveProperty('response');
      expect(result.structuredContent).not.toHaveProperty('field_descriptions');
    });

    it('serializes structuredContent into the content text block (backwards-compat)', async () => {
      const handler = registeredHandlers.get('get_athlete_profile');
      expect(handler).toBeDefined();

      const result = (await handler!({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: Record<string, unknown>;
      };

      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    });
  });

  describe('error handling', () => {
    it('should handle retryable ApiError and return structured response', () => {
      const retryableError = new ApiError(
        'Rate limited',
        'rate_limit',
        true,
        { operation: 'fetch recovery' },
        'whoop',
        429
      );

      expect(retryableError.isRetryable).toBe(true);
      expect(retryableError.category).toBe('rate_limit');
      expect(retryableError.message).toBe('Rate limited');
    });

    it('should handle non-retryable ApiError', () => {
      const nonRetryableError = new ApiError(
        'Invalid token',
        'authentication',
        false,
        { operation: 'authenticate' },
        'whoop',
        401
      );

      expect(nonRetryableError.isRetryable).toBe(false);
      expect(nonRetryableError.statusCode).toBe(401);
      expect(nonRetryableError.category).toBe('authentication');
    });

    it('should handle DateParseError with helpful message', () => {
      const dateError = new DateParseError('invalid date input', 'oldest');

      expect(dateError.isRetryable).toBe(false);
      expect(dateError.category).toBe('date_parse');
      expect(dateError.parameterName).toBe('oldest');
      expect(dateError.input).toBe('invalid date input');
      expect(dateError.message).toContain('oldest');
      expect(dateError.message).toContain('invalid date input');
    });

    it('should handle IntervalsApiError with context', () => {
      const intervalsError = IntervalsApiError.fromHttpStatus(404, {
        operation: 'fetch workout',
        resource: 'activity i123456',
      });

      expect(intervalsError.isRetryable).toBe(false);
      expect(intervalsError.category).toBe('not_found');
      expect(intervalsError.statusCode).toBe(404);
      expect(intervalsError.message).toContain('i123456');
    });

    it('should include what_happened and how_to_fix in error responses', () => {
      const error = new ApiError(
        'Test error',
        'not_found',
        false,
        { operation: 'fetch data', resource: 'activity 123' },
        'intervals',
        404
      );

      expect(error.getWhatHappened()).toContain('fetch data');
      expect(error.getWhatHappened()).toContain('activity 123');
      expect(error.getHowToFix()).toContain('Double-check');
    });
  });

  describe('structuredContent format', () => {
    it('returns a plain JSON object with no envelope wrapper', async () => {
      const handler = registeredHandlers.get('get_athlete_profile');
      expect(handler).toBeDefined();

      const result = (await handler!({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: Record<string, unknown>;
      };

      expect(result.structuredContent).toBeDefined();
      // Per the 2025-11-25 MCP spec, when an outputSchema is declared the
      // structuredContent must be the typed payload itself, not a wrapper.
      expect(result.structuredContent).not.toHaveProperty('response');
      expect(result.structuredContent).not.toHaveProperty('field_descriptions');
    });
  });

  describe('tool registration', () => {
    it('should register all expected tools', () => {
      expect(registeredHandlers.size).toBe(29);

      // Verify key tools are registered
      expect(registeredHandlers.has('get_workout_music')).toBe(true);
      expect(registeredHandlers.has('get_todays_summary')).toBe(true);
      expect(registeredHandlers.has('get_todays_workouts')).toBe(true);
      expect(registeredHandlers.has('get_athlete_profile')).toBe(true);
      expect(registeredHandlers.has('get_sports_settings')).toBe(true);
      expect(registeredHandlers.has('get_strain_history')).toBe(true);
      expect(registeredHandlers.has('get_workout_history')).toBe(true);
      expect(registeredHandlers.has('get_recovery_trends')).toBe(true);
      expect(registeredHandlers.has('get_wellness_trends')).toBe(true);
      expect(registeredHandlers.has('get_activity_totals')).toBe(true);
      expect(registeredHandlers.has('get_upcoming_workouts')).toBe(true);
      expect(registeredHandlers.has('get_upcoming_races')).toBe(true);
      expect(registeredHandlers.has('get_training_load_trends')).toBe(true);
      expect(registeredHandlers.has('get_workout_intervals')).toBe(true);
      expect(registeredHandlers.has('get_workout_notes')).toBe(true);
      expect(registeredHandlers.has('get_workout_weather')).toBe(true);
      expect(registeredHandlers.has('get_workout_heat_zones')).toBe(true);
      expect(registeredHandlers.has('get_workout_details')).toBe(true);
      expect(registeredHandlers.has('get_power_curve')).toBe(true);
      expect(registeredHandlers.has('get_pace_curve')).toBe(true);
      expect(registeredHandlers.has('get_hr_curve')).toBe(true);
      // Workout sync tools
      expect(registeredHandlers.has('create_run_workout')).toBe(true);
      expect(registeredHandlers.has('delete_workout')).toBe(true);
      expect(registeredHandlers.has('sync_trainerroad_runs')).toBe(true);
      // Cycling workout tools
      expect(registeredHandlers.has('create_cycling_workout')).toBe(true);
    });

    it('should set up timezone getter when Whoop client is configured', async () => {
      const { WhoopClient } = await import('../../src/clients/whoop.js');
      expect(WhoopClient).toHaveBeenCalled();
      // The setTimezoneGetter should be called during construction
      const mockInstance = vi.mocked(WhoopClient).mock.results[0]?.value;
      if (mockInstance) {
        expect(mockInstance.setTimezoneGetter).toHaveBeenCalled();
      }
    });
  });
});

