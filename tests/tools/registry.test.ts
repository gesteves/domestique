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
      getSportSettingsForSport: vi.fn().mockResolvedValue({ sport: 'cycling', settings: {} }),
      getUnitPreferences: vi.fn().mockResolvedValue({ system: 'metric', weight: 'kg', temperature: 'celsius' }),
      setPlayedSongsGetter: vi.fn(),
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

vi.mock('../../src/clients/lastfm.js', () => ({
  LastFmClient: vi.fn().mockImplementation(function() {
    return {
      getPlayedSongsDuring: vi.fn().mockResolvedValue([]),
    };
  }),
}));

const fullConfig = {
  intervals: { apiKey: 'test', athleteId: 'test' },
  whoop: {
    accessToken: 'test',
    refreshToken: 'test',
    clientId: 'test',
    clientSecret: 'test',
  },
  trainerroad: { calendarUrl: 'https://test.com' },
  lastfm: { username: 'test', apiKey: 'test' },
};

function collectRegisteredTools(registry: ToolRegistry): string[] {
  const names: string[] = [];
  const mockServer = {
    registerTool: vi.fn().mockImplementation((name: string) => {
      names.push(name);
    }),
  };
  registry.registerTools(mockServer as any);
  return names;
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry(fullConfig);
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
        registerTool: vi.fn().mockImplementation((name: string) => {
          registeredTools.push(name);
        }),
      };

      registry.registerTools(mockServer as any);

      expect(registeredTools).toContain('get_todays_summary');
      expect(registeredTools).toContain('get_todays_workouts');
      expect(registeredTools).toContain('get_athlete_profile');
      expect(registeredTools).toContain('get_strain_history');
      expect(registeredTools).toContain('get_workout_history');
      expect(registeredTools).toContain('get_recovery_trends');
      expect(registeredTools).toContain('get_upcoming_workouts');
      // Analysis tools
      expect(registeredTools).toContain('get_training_load_trends');
      expect(registeredTools).toContain('get_workout_details');
      expect(registeredTools).toContain('get_workout_intervals');
      expect(registeredTools).toContain('get_workout_notes');
      expect(registeredTools).toContain('get_workout_weather');
      expect(registeredTools).toContain('get_workout_heat_zones');
      // Performance curves
      expect(registeredTools).toContain('get_power_curve');
      expect(registeredTools).toContain('get_pace_curve');
      expect(registeredTools).toContain('get_hr_curve');
      // Sports settings
      expect(registeredTools).toContain('get_sports_settings');
      // Wellness
      expect(registeredTools).toContain('get_wellness_trends');
      // Activity totals
      expect(registeredTools).toContain('get_activity_totals');
      // Races
      expect(registeredTools).toContain('get_upcoming_races');
      // Workout management tools
      expect(registeredTools).toContain('create_workout');
      expect(registeredTools).toContain('update_workout');
      expect(registeredTools).toContain('delete_workout');
      expect(registeredTools).toContain('sync_trainerroad_runs');
      expect(registeredTools).toContain('set_workout_intervals');
      expect(registeredTools).toContain('update_activity');
      expect(registeredTools).toContain('get_workout_music');
      expect(registeredTools.length).toBe(27);
    });

    it('should call server.registerTool for each tool', () => {
      const mockServer = {
        registerTool: vi.fn(),
      };

      registry.registerTools(mockServer as any);

      expect(mockServer.registerTool).toHaveBeenCalledTimes(27);
    });

    it('skips Whoop-dependent tools when Whoop is not configured', () => {
      const registryNoWhoop = new ToolRegistry({ ...fullConfig, whoop: null });
      const names = collectRegisteredTools(registryNoWhoop);

      expect(names).not.toContain('get_strain_history');
      expect(names).not.toContain('get_recovery_trends');
      // Tools that use Whoop only for optional enrichment stay registered
      expect(names).toContain('get_todays_summary');
      expect(names).toContain('get_todays_workouts');
      expect(names).toContain('get_workout_history');
      expect(names.length).toBe(25);
    });

    it('skips TrainerRoad-dependent tools when TrainerRoad is not configured', () => {
      const registryNoTr = new ToolRegistry({ ...fullConfig, trainerroad: null });
      const names = collectRegisteredTools(registryNoTr);

      expect(names).not.toContain('get_upcoming_races');
      expect(names).not.toContain('sync_trainerroad_runs');
      // Planning tools that only need Intervals stay registered
      expect(names).toContain('get_upcoming_workouts');
      expect(names).toContain('create_workout');
      expect(names.length).toBe(25);
    });

    it('skips Last.fm-dependent tools when Last.fm is not configured', () => {
      const registryNoLastfm = new ToolRegistry({ ...fullConfig, lastfm: null });
      const names = collectRegisteredTools(registryNoLastfm);

      expect(names).not.toContain('get_workout_music');
      expect(names.length).toBe(26);
    });

    it('registers only Intervals-only tools when all optional clients are missing', () => {
      const registryMinimal = new ToolRegistry({
        intervals: fullConfig.intervals,
        whoop: null,
        trainerroad: null,
        lastfm: null,
      });
      const names = collectRegisteredTools(registryMinimal);

      expect(names).not.toContain('get_strain_history');
      expect(names).not.toContain('get_recovery_trends');
      expect(names).not.toContain('get_upcoming_races');
      expect(names).not.toContain('sync_trainerroad_runs');
      expect(names).not.toContain('get_workout_music');
      // 27 - 5 skipped = 22
      expect(names.length).toBe(22);
    });

    it('should pass config object with title, description, and annotations to each tool', () => {
      const mockServer = {
        registerTool: vi.fn(),
      };

      registry.registerTools(mockServer as any);

      // Check first tool call has correct structure (registerTool uses name, config, handler)
      const [name, config, handler] = mockServer.registerTool.mock.calls[0];
      expect(typeof name).toBe('string');
      expect(typeof config).toBe('object');
      expect(typeof config.title).toBe('string'); // Human-readable title
      expect(typeof config.description).toBe('string');
      expect(config.annotations).toBeDefined();
      expect(typeof handler).toBe('function');

      // Verify all tools have titles
      for (const call of mockServer.registerTool.mock.calls) {
        const [toolName, toolConfig] = call;
        expect(toolConfig.title, `Tool ${toolName} should have a title`).toBeDefined();
        expect(typeof toolConfig.title).toBe('string');
      }
    });
  });
});
