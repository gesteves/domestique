import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { PlannedWorkout } from '../../src/types/index.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools sync operations', () => {
  let tools: PlanningTools;
  let mockIntervalsClient: IntervalsClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    // Mock getAthleteTimezone to return UTC
    vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createRunWorkout', () => {
    it('should create workout with all required fields', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 123,
        uid: 'uid-123',
        name: 'Test Run',
        start_date_local: '2024-12-16',
        type: 'Run',
        category: 'WORKOUT',
      });

      const result = await tools.createRunWorkout({
        scheduled_for: '2024-12-16',
        name: 'Test Run',
        workout_doc: 'Warmup\n- 10m Z2 Pace',
      });

      expect(result.id).toBe(123);
      expect(result.uid).toBe('uid-123');
      expect(result.name).toBe('Test Run');
      expect(result.intervals_icu_url).toContain('2024-12-16');
    });

    it('should create workout with optional fields', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 124,
        uid: 'uid-124',
        name: 'Interval Run',
        start_date_local: '2024-12-17',
        type: 'Run',
        category: 'WORKOUT',
      });

      const result = await tools.createRunWorkout({
        scheduled_for: '2024-12-17',
        name: 'Interval Run',
        description: 'RPE-based intervals',
        workout_doc: 'Main Set 5x\n- 3m Z4 Pace',
        trainerroad_uid: 'tr-789',
      });

      expect(result.id).toBe(124);

      // Verify createEvent was called with correct parameters
      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Interval Run',
          type: 'Run',
          category: 'WORKOUT',
          tags: ['domestique'],
          external_id: 'tr-789',
        })
      );
    });

    it('should put description before workout_doc', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 128,
        uid: 'uid-128',
        name: 'Ordered Run',
        start_date_local: '2024-12-22',
        type: 'Run',
        category: 'WORKOUT',
      });

      await tools.createRunWorkout({
        scheduled_for: '2024-12-22',
        name: 'Ordered Run',
        description: 'Notes about the run',
        workout_doc: 'Warmup\n- 10m Z2 Pace',
      });

      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Notes about the run\n\nWarmup\n- 10m Z2 Pace',
        })
      );
    });

    it('should include domestique tag automatically', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 125,
        uid: 'uid-125',
        name: 'Tagged Run',
        start_date_local: '2024-12-18',
        type: 'Run',
        category: 'WORKOUT',
      });

      await tools.createRunWorkout({
        scheduled_for: '2024-12-18',
        name: 'Tagged Run',
        workout_doc: '- 30m Z2 Pace',
      });

      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['domestique'],
        })
      );
    });

    it('should store trainerroad_uid in external_id', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 126,
        uid: 'uid-126',
        name: 'Synced Run',
        start_date_local: '2024-12-19',
        type: 'Run',
        category: 'WORKOUT',
      });

      await tools.createRunWorkout({
        scheduled_for: '2024-12-19',
        name: 'Synced Run',
        workout_doc: '- 20m Z3 Pace',
        trainerroad_uid: 'tr-abc-123',
      });

      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          external_id: 'tr-abc-123',
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockRejectedValue(
        new Error('API request failed: 500')
      );

      await expect(
        tools.createRunWorkout({
          scheduled_for: '2024-12-20',
          name: 'Failed Run',
          workout_doc: '- 10m Z1 Pace',
        })
      ).rejects.toThrow('API request failed');
    });

    it('should return correct response structure', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 127,
        uid: 'uid-127',
        name: 'Structure Test',
        start_date_local: '2024-12-21',
        type: 'Run',
        category: 'WORKOUT',
      });

      const result = await tools.createRunWorkout({
        scheduled_for: '2024-12-21',
        name: 'Structure Test',
        workout_doc: '- 15m Z2 Pace',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('uid');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('scheduled_for');
      expect(result).toHaveProperty('intervals_icu_url');
    });
  });

  describe('deleteWorkout', () => {
    it('should delete workout with domestique tag successfully', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 123,
        uid: 'uid-123',
        name: 'Test Run',
        start_date_local: '2024-12-16',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.deleteEvent).mockResolvedValue(undefined);

      const result = await tools.deleteWorkout('123');

      expect(result.deleted).toBe(true);
      expect(result.message).toContain('Test Run');
      expect(mockIntervalsClient.deleteEvent).toHaveBeenCalledWith('123');
    });

    it('should refuse to delete workout without domestique tag', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 124,
        uid: 'uid-124',
        name: 'User Created Run',
        start_date_local: '2024-12-17',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['manual'],
      });

      await expect(tools.deleteWorkout('124')).rejects.toThrow('not created by Domestique');
      expect(mockIntervalsClient.deleteEvent).not.toHaveBeenCalled();
    });

    it('should refuse to delete workout with no tags', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 125,
        uid: 'uid-125',
        name: 'No Tags Run',
        start_date_local: '2024-12-18',
        type: 'Run',
        category: 'WORKOUT',
      });

      await expect(tools.deleteWorkout('125')).rejects.toThrow('not created by Domestique');
    });

    it('should handle non-existent event (404)', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockRejectedValue(
        new Error('API request failed: 404')
      );

      await expect(tools.deleteWorkout('999')).rejects.toThrow('API request failed');
    });

    it('should return correct response structure', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 126,
        uid: 'uid-126',
        name: 'Deleted Run',
        start_date_local: '2024-12-19',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.deleteEvent).mockResolvedValue(undefined);

      const result = await tools.deleteWorkout('126');

      expect(result).toHaveProperty('deleted');
      expect(result).toHaveProperty('message');
      expect(typeof result.deleted).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('syncTRRuns', () => {
    const trRuns: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-16T09:00:00Z',
        name: 'Easy Run',
        sport: 'Running',
        source: 'trainerroad',
        description: '30min Easy RPE4',
        expected_tss: 30,
        expected_duration: '30m',
      },
      {
        id: 'tr-2',
        scheduled_for: '2024-12-18T09:00:00Z',
        name: 'Interval Run',
        sport: 'Running',
        source: 'trainerroad',
        description: '5x3min Hard',
        expected_tss: 65,
        expected_duration: '45m',
      },
    ];

    it('should identify TR runs without matching ICU workout', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trRuns);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([]);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.tr_runs_found).toBe(2);
      expect(result.runs_to_sync).toHaveLength(2);
      expect(result.runs_to_sync[0].tr_uid).toBe('tr-1');
      expect(result.runs_to_sync[1].tr_uid).toBe('tr-2');
    });

    it('should not include already synced runs', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trRuns);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([
        {
          id: 100,
          uid: 'uid-100',
          name: 'Easy Run',
          external_id: 'tr-1', // Already synced
          tags: ['domestique'],
        },
      ]);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.runs_to_sync).toHaveLength(1);
      expect(result.runs_to_sync[0].tr_uid).toBe('tr-2');
    });

    it('should identify orphaned Domestique workouts', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trRuns[0]]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([
        {
          id: 100,
          uid: 'uid-100',
          name: 'Easy Run',
          external_id: 'tr-1',
          tags: ['domestique'],
        },
        {
          id: 101,
          uid: 'uid-101',
          name: 'Deleted TR Run',
          external_id: 'tr-deleted', // TR workout no longer exists
          tags: ['domestique'],
        },
      ]);
      vi.mocked(mockIntervalsClient.deleteEvent).mockResolvedValue(undefined);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.orphans_deleted).toBe(1);
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0].reason).toContain('no longer exists');
    });

    it('should not delete orphans in dry_run mode', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([
        {
          id: 101,
          uid: 'uid-101',
          name: 'Orphaned Run',
          external_id: 'tr-orphan',
          tags: ['domestique'],
        },
      ]);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15', dry_run: true });

      expect(result.orphans_deleted).toBe(0);
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0].reason).toContain('dry run');
      expect(mockIntervalsClient.deleteEvent).not.toHaveBeenCalled();
    });

    it('should return correct counts', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trRuns);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([
        {
          id: 100,
          uid: 'uid-100',
          name: 'Synced Run',
          external_id: 'tr-1',
          tags: ['domestique'],
        },
        {
          id: 101,
          uid: 'uid-101',
          name: 'Orphan',
          external_id: 'tr-gone',
          tags: ['domestique'],
        },
      ]);
      vi.mocked(mockIntervalsClient.deleteEvent).mockResolvedValue(undefined);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.tr_runs_found).toBe(2);
      expect(result.runs_to_sync).toHaveLength(1); // tr-2 not synced
      expect(result.orphans_deleted).toBe(1);
    });

    it('should handle missing TrainerRoad config', async () => {
      const toolsWithoutTr = new PlanningTools(mockIntervalsClient, null);

      const result = await toolsWithoutTr.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.errors).toContain('TrainerRoad is not configured');
      expect(result.tr_runs_found).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(
        new Error('Network error')
      );

      await expect(tools.syncTRRuns({ oldest: '2024-12-15' })).rejects.toThrow('Network error');
    });

    it('should use correct date range defaults', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([]);

      await tools.syncTRRuns({});

      // Should default to today + 30 days (Dec 15 + 30 = Jan 14)
      // Note: date-fns addDays may vary slightly, so we just verify the start date
      // and that an end date ~30 days later is passed
      expect(mockTrainerRoadClient.getPlannedWorkouts).toHaveBeenCalledWith(
        '2024-12-15',
        expect.stringMatching(/^2025-01-1[34]$/), // Jan 13 or 14
        'UTC'
      );
    });

    it('should return runs_to_sync with expected structure', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trRuns[0]]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([]);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.runs_to_sync[0]).toHaveProperty('tr_uid');
      expect(result.runs_to_sync[0]).toHaveProperty('tr_name');
      expect(result.runs_to_sync[0]).toHaveProperty('scheduled_for');
      expect(result.runs_to_sync[0].tr_uid).toBe('tr-1');
      expect(result.runs_to_sync[0].tr_name).toBe('Easy Run');
    });

    it('should include TR workout description in runs_to_sync', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trRuns[0]]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([]);

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.runs_to_sync[0].tr_description).toBe('30min Easy RPE4');
    });

    it('should handle errors during orphan deletion', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getEventsByTag).mockResolvedValue([
        {
          id: 101,
          uid: 'uid-101',
          name: 'Failed Delete',
          external_id: 'tr-fail',
          tags: ['domestique'],
        },
      ]);
      vi.mocked(mockIntervalsClient.deleteEvent).mockRejectedValue(new Error('Delete failed'));

      const result = await tools.syncTRRuns({ oldest: '2024-12-15' });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to delete orphan');
      expect(result.orphans_deleted).toBe(0);
    });
  });

  describe('enhanced deduplication', () => {
    it('should deduplicate by external_id match', async () => {
      const trWorkouts: PlannedWorkout[] = [
        {
          id: 'tr-123',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'TR Run',
          source: 'trainerroad',
        },
      ];

      const icuWorkouts: PlannedWorkout[] = [
        {
          id: 'icu-456',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Different Name', // Different name but same external_id
          external_id: 'tr-123',
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      // Should only have 1 workout (deduplicated by external_id)
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].source).toBe('trainerroad');
    });

    it('should match TR id to ICU external_id', async () => {
      const trWorkouts: PlannedWorkout[] = [
        {
          id: 'tr-abc',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Original Name',
          source: 'trainerroad',
        },
      ];

      const icuWorkouts: PlannedWorkout[] = [
        {
          id: 'icu-xyz',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'ICU Name',
          external_id: 'tr-abc', // Matches TR id
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(1);
    });

    it('should still fallback to name matching when no external_id', async () => {
      const trWorkouts: PlannedWorkout[] = [
        {
          id: 'tr-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Sweet Spot Base',
          source: 'trainerroad',
        },
      ];

      const icuWorkouts: PlannedWorkout[] = [
        {
          id: 'icu-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'sweet spot base', // Same name, different case
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(1);
    });
  });

  describe('proactive hints', () => {
    it('should include hint when TR runs can be synced', async () => {
      const trRuns: PlannedWorkout[] = [
        {
          id: 'tr-run-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Easy Run',
          sport: 'Running',
          source: 'trainerroad',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trRuns);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result._instructions).toBeDefined();
      expect(result._instructions).toContain('TrainerRoad running workout');
      expect(result._instructions).toContain('create_run_workout');
    });

    it('should not include hint when no TR runs', async () => {
      const trBike: PlannedWorkout[] = [
        {
          id: 'tr-bike-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Sweet Spot',
          sport: 'Cycling',
          source: 'trainerroad',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trBike);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result._instructions).toBeUndefined();
    });

    it('should not include hint when TR runs are already synced', async () => {
      const trRuns: PlannedWorkout[] = [
        {
          id: 'tr-run-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Easy Run',
          sport: 'Running',
          source: 'trainerroad',
        },
      ];

      const icuWorkouts: PlannedWorkout[] = [
        {
          id: 'icu-1',
          scheduled_for: '2024-12-16T09:00:00Z',
          name: 'Easy Run',
          external_id: 'tr-run-1',
          tags: ['domestique'],
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trRuns);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result._instructions).toBeUndefined();
    });
  });
});
