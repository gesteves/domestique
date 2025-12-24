import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../../src/tools/index.js';

// Mock all clients
vi.mock('../../src/clients/intervals.js', () => ({
  IntervalsClient: vi.fn().mockImplementation(function() {
    return {
      getActivities: vi.fn().mockResolvedValue([]),
      getPlannedEvents: vi.fn().mockResolvedValue([]),
      getFitnessMetrics: vi.fn().mockResolvedValue([]),
      getTrainingLoadTrends: vi.fn().mockResolvedValue({ data: [], summary: {} }),
      getAthleteTimezone: vi.fn().mockResolvedValue('America/New_York'),
      getAthleteProfile: vi.fn().mockResolvedValue({ id: 'test', sports: [] }),
      getActivityIntervals: vi.fn().mockResolvedValue({ activity_id: 'test', intervals: [], groups: [] }),
    };
  }),
}));

vi.mock('../../src/clients/whoop.js', () => ({
  WhoopClient: vi.fn().mockImplementation(function() {
    return {
      getTodayRecovery: vi.fn().mockResolvedValue(null),
      getStrainData: vi.fn().mockResolvedValue([]),
      getRecoveries: vi.fn().mockResolvedValue([]),
      getWorkouts: vi.fn().mockResolvedValue([]),
      setTimezoneGetter: vi.fn(),
    };
  }),
}));

vi.mock('../../src/clients/trainerroad.js', () => ({
  TrainerRoadClient: vi.fn().mockImplementation(function() {
    return {
      getTodayWorkouts: vi.fn().mockResolvedValue([]),
      getPlannedWorkouts: vi.fn().mockResolvedValue([]),
      getUpcomingWorkouts: vi.fn().mockResolvedValue([]),
    };
  }),
}));

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  describe('constructor', () => {
    it('should create registry with all clients', () => {
      expect(registry).toBeDefined();
    });

    it('should create registry without Whoop client', () => {
      const registryWithoutWhoop = new ToolRegistry({
        intervals: { apiKey: 'test', athleteId: 'test' },
        whoop: null,
        trainerroad: { calendarUrl: 'https://test.com' },
      });

      expect(registryWithoutWhoop).toBeDefined();
    });

    it('should create registry without TrainerRoad client', () => {
      const registryWithoutTr = new ToolRegistry({
        intervals: { apiKey: 'test', athleteId: 'test' },
        whoop: {
          accessToken: 'test',
          refreshToken: 'test',
          clientId: 'test',
          clientSecret: 'test',
        },
        trainerroad: null,
      });

      expect(registryWithoutTr).toBeDefined();
    });
  });

  describe('registerTools', () => {
    it('should register tools with mock server', () => {
      const registeredTools: string[] = [];
      const mockServer = {
        tool: vi.fn().mockImplementation((name: string) => {
          registeredTools.push(name);
        }),
      };

      registry.registerTools(mockServer as any);

      expect(registeredTools).toContain('get_todays_recovery');
      expect(registeredTools).toContain('get_todays_strain');
      expect(registeredTools).toContain('get_todays_completed_workouts');
      expect(registeredTools).toContain('get_todays_planned_workouts');
      expect(registeredTools).toContain('get_athlete_profile');
      expect(registeredTools).toContain('get_strain_history');
      expect(registeredTools).toContain('get_workout_history');
      expect(registeredTools).toContain('get_recovery_trends');
      expect(registeredTools).toContain('get_upcoming_workouts');
      expect(registeredTools).toContain('get_planned_workout_details');
      // Analysis tools
      expect(registeredTools).toContain('get_training_load_trends');
      expect(registeredTools).toContain('get_workout_intervals');
      expect(registeredTools.length).toBe(12);
    });

    it('should call server.tool for each tool', () => {
      const mockServer = {
        tool: vi.fn(),
      };

      registry.registerTools(mockServer as any);

      expect(mockServer.tool).toHaveBeenCalledTimes(12);
    });

    it('should pass description and schema to each tool', () => {
      const mockServer = {
        tool: vi.fn(),
      };

      registry.registerTools(mockServer as any);

      // Check first tool call has correct structure
      const [name, description, schema, handler] = mockServer.tool.mock.calls[0];
      expect(typeof name).toBe('string');
      expect(typeof description).toBe('string');
      expect(typeof schema).toBe('object');
      expect(typeof handler).toBe('function');
    });
  });
});
