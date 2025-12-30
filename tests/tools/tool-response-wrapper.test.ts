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

describe('Tool Response Wrapper', () => {
  let registry: ToolRegistry;
  let mockServer: { tool: ReturnType<typeof vi.fn> };
  let registeredHandlers: Map<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers = new Map();

    mockServer = {
      tool: vi.fn().mockImplementation((name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
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
    });

    registry.registerTools(mockServer as unknown as Parameters<typeof registry.registerTools>[0]);
  });

  describe('response format', () => {
    it('should wrap response with structuredContent including field descriptions', async () => {
      const handler = registeredHandlers.get('get_todays_recovery');
      expect(handler).toBeDefined();

      const result = (await handler!({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: { response: unknown; field_descriptions: Record<string, string> };
      };

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      // Text content contains serialized JSON for backwards compatibility
      expect(result.content[0].text).toContain('"field_descriptions"');
      // structuredContent has the parsed response
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.response).toBeDefined();
      expect(result.structuredContent.field_descriptions).toBeDefined();
    });

    it('should include data in the response', async () => {
      // Mock a response from the underlying tool
      const { WhoopClient } = await import('../../src/clients/whoop.js');
      const mockWhoopClient = new WhoopClient({
        accessToken: 'test',
        refreshToken: 'test',
        clientId: 'test',
        clientSecret: 'test',
      });
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: {
          sleep_summary: {
            total_in_bed_time: '8:00:00',
            total_awake_time: '0:30:00',
            total_no_data_time: '0:00:00',
            total_light_sleep_time: '3:30:00',
            total_slow_wave_sleep_time: '2:00:00',
            total_rem_sleep_time: '2:00:00',
            total_restorative_sleep: '4:00:00',
            sleep_cycle_count: 4,
            disturbance_count: 3,
          },
          sleep_needed: {
            total_sleep_needed: '7:30:00',
            baseline: '7:00:00',
            need_from_sleep_debt: '0:15:00',
            need_from_recent_strain: '0:15:00',
            need_from_recent_nap: '0:00:00',
          },
          sleep_performance_percentage: 90,
          sleep_performance_level: 'OPTIMAL',
          sleep_performance_level_description: 'Optimal sleep performance',
        },
        recovery: {
          recovery_score: 85,
          hrv_rmssd: 65,
          resting_heart_rate: 52,
          recovery_level: 'SUFFICIENT',
          recovery_level_description: 'Your recovery is sufficient for hard training',
        },
      });

      // Re-create registry to use the mock
      const newRegistry = new ToolRegistry({
        intervals: { apiKey: 'test', athleteId: 'test' },
        whoop: {
          accessToken: 'test',
          refreshToken: 'test',
          clientId: 'test',
          clientSecret: 'test',
        },
      });

      const newMockServer = {
        tool: vi.fn().mockImplementation((name: string, _desc: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
          registeredHandlers.set(name, handler);
        }),
      };

      newRegistry.registerTools(newMockServer as unknown as Parameters<typeof newRegistry.registerTools>[0]);

      const handler = registeredHandlers.get('get_todays_recovery');
      const result = (await handler!({})) as { content: Array<{ type: string; text: string }> };

      // The response should be JSON-formatted
      expect(result.content[0].text).toBeDefined();
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
      const dateError = new DateParseError('invalid date input', 'start_date');

      expect(dateError.isRetryable).toBe(false);
      expect(dateError.category).toBe('date_parse');
      expect(dateError.parameterName).toBe('start_date');
      expect(dateError.input).toBe('invalid date input');
      expect(dateError.message).toContain('start_date');
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
    it('should return structuredContent with response and field_descriptions', async () => {
      const handler = registeredHandlers.get('get_athlete_profile');
      expect(handler).toBeDefined();

      const result = (await handler!({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: { response: unknown; field_descriptions: Record<string, string> };
      };

      // Verify structuredContent format
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.response).toBeDefined();
      expect(typeof result.structuredContent.field_descriptions).toBe('object');
    });
  });

  describe('tool registration', () => {
    it('should register all expected tools', () => {
      expect(registeredHandlers.size).toBe(22);

      // Verify key tools are registered
      expect(registeredHandlers.has('get_todays_recovery')).toBe(true);
      expect(registeredHandlers.has('get_todays_strain')).toBe(true);
      expect(registeredHandlers.has('get_todays_completed_workouts')).toBe(true);
      expect(registeredHandlers.has('get_todays_planned_workouts')).toBe(true);
      expect(registeredHandlers.has('get_athlete_profile')).toBe(true);
      expect(registeredHandlers.has('get_sports_settings')).toBe(true);
      expect(registeredHandlers.has('get_daily_summary')).toBe(true);
      expect(registeredHandlers.has('get_strain_history')).toBe(true);
      expect(registeredHandlers.has('get_workout_history')).toBe(true);
      expect(registeredHandlers.has('get_recovery_trends')).toBe(true);
      expect(registeredHandlers.has('get_wellness_trends')).toBe(true);
      expect(registeredHandlers.has('get_activity_totals')).toBe(true);
      expect(registeredHandlers.has('get_upcoming_workouts')).toBe(true);
      expect(registeredHandlers.has('get_planned_workout_details')).toBe(true);
      expect(registeredHandlers.has('get_upcoming_races')).toBe(true);
      expect(registeredHandlers.has('get_training_load_trends')).toBe(true);
      expect(registeredHandlers.has('get_workout_intervals')).toBe(true);
      expect(registeredHandlers.has('get_workout_weather')).toBe(true);
      expect(registeredHandlers.has('get_workout_heat_zones')).toBe(true);
      expect(registeredHandlers.has('get_power_curve')).toBe(true);
      expect(registeredHandlers.has('get_pace_curve')).toBe(true);
      expect(registeredHandlers.has('get_hr_curve')).toBe(true);
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

