import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools updateWorkout', () => {
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

  describe('updateWorkout', () => {
    it('should update workout name', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 123,
        uid: 'uid-123',
        name: 'Original Name',
        start_date_local: '2024-12-16T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 123,
        uid: 'uid-123',
        name: 'Updated Name',
        start_date_local: '2024-12-16T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '123',
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.updated_fields).toContain('name');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          name: 'Updated Name',
          tags: ['domestique'],
        })
      );
    });

    it('should update workout description', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 124,
        uid: 'uid-124',
        name: 'Test Run',
        start_date_local: '2024-12-17T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 124,
        uid: 'uid-124',
        name: 'Test Run',
        start_date_local: '2024-12-17T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '124',
        description: 'New workout notes',
      });

      expect(result.updated_fields).toContain('description');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '124',
        expect.objectContaining({
          description: 'New workout notes\n\n',
          tags: ['domestique'],
        })
      );
    });

    it('should update workout_doc', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 125,
        uid: 'uid-125',
        name: 'Interval Run',
        start_date_local: '2024-12-18T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 125,
        uid: 'uid-125',
        name: 'Interval Run',
        start_date_local: '2024-12-18T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '125',
        workout_doc: 'Warmup\n- 10m Z2 Pace\n\nMain Set 5x\n- 3m Z4 Pace',
      });

      expect(result.updated_fields).toContain('workout_doc');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '125',
        expect.objectContaining({
          description: 'Warmup\n- 10m Z2 Pace\n\nMain Set 5x\n- 3m Z4 Pace',
          tags: ['domestique'],
        })
      );
    });

    it('should combine description and workout_doc', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 126,
        uid: 'uid-126',
        name: 'Combined Test',
        start_date_local: '2024-12-19T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 126,
        uid: 'uid-126',
        name: 'Combined Test',
        start_date_local: '2024-12-19T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '126',
        description: 'RPE based intervals',
        workout_doc: 'Main Set 3x\n- 5m Z3 Pace',
      });

      expect(result.updated_fields).toContain('description');
      expect(result.updated_fields).toContain('workout_doc');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '126',
        expect.objectContaining({
          description: 'RPE based intervals\n\nMain Set 3x\n- 5m Z3 Pace',
        })
      );
    });

    it('should update scheduled_for with date only', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 127,
        uid: 'uid-127',
        name: 'Date Change Test',
        start_date_local: '2024-12-16T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 127,
        uid: 'uid-127',
        name: 'Date Change Test',
        start_date_local: '2024-12-20T00:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '127',
        scheduled_for: '2024-12-20',
      });

      expect(result.updated_fields).toContain('scheduled_for');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '127',
        expect.objectContaining({
          start_date_local: '2024-12-20T00:00:00',
        })
      );
    });

    it('should update scheduled_for with full datetime', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 128,
        uid: 'uid-128',
        name: 'Time Change Test',
        start_date_local: '2024-12-16T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 128,
        uid: 'uid-128',
        name: 'Time Change Test',
        start_date_local: '2024-12-21T14:30:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '128',
        scheduled_for: '2024-12-21T14:30:00',
      });

      expect(result.updated_fields).toContain('scheduled_for');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '128',
        expect.objectContaining({
          start_date_local: '2024-12-21T14:30:00',
        })
      );
    });

    it('should update type', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 129,
        uid: 'uid-129',
        name: 'Type Change Test',
        start_date_local: '2024-12-17T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 129,
        uid: 'uid-129',
        name: 'Type Change Test',
        start_date_local: '2024-12-17T09:00:00',
        type: 'Ride',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '129',
        type: 'Ride',
      });

      expect(result.updated_fields).toContain('type');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '129',
        expect.objectContaining({
          type: 'Ride',
        })
      );
    });

    it('should preserve domestique tag when updating', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 130,
        uid: 'uid-130',
        name: 'Tag Test',
        start_date_local: '2024-12-18T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique', 'running', 'easy'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 130,
        uid: 'uid-130',
        name: 'Tag Test Updated',
        start_date_local: '2024-12-18T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique', 'running', 'easy'],
      });

      await tools.updateWorkout({
        event_id: '130',
        name: 'Tag Test Updated',
      });

      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '130',
        expect.objectContaining({
          tags: ['domestique', 'running', 'easy'],
        })
      );
    });

    it('should refuse to update workout without domestique tag', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 131,
        uid: 'uid-131',
        name: 'User Created Run',
        start_date_local: '2024-12-19T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['manual'],
      });

      await expect(
        tools.updateWorkout({
          event_id: '131',
          name: 'Attempted Update',
        })
      ).rejects.toThrow('not created by Domestique');

      expect(mockIntervalsClient.updateEvent).not.toHaveBeenCalled();
    });

    it('should refuse to update workout with no tags', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 132,
        uid: 'uid-132',
        name: 'No Tags Run',
        start_date_local: '2024-12-20T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
      });

      await expect(
        tools.updateWorkout({
          event_id: '132',
          name: 'Attempted Update',
        })
      ).rejects.toThrow('not created by Domestique');
    });

    it('should throw error when no fields provided', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 133,
        uid: 'uid-133',
        name: 'Empty Update Test',
        start_date_local: '2024-12-21T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      await expect(
        tools.updateWorkout({
          event_id: '133',
        })
      ).rejects.toThrow('No fields provided to update');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 134,
        uid: 'uid-134',
        name: 'API Error Test',
        start_date_local: '2024-12-22T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockRejectedValue(
        new Error('API request failed: 500')
      );

      await expect(
        tools.updateWorkout({
          event_id: '134',
          name: 'Will Fail',
        })
      ).rejects.toThrow('API request failed');
    });

    it('should handle non-existent event (404)', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockRejectedValue(
        new Error('API request failed: 404')
      );

      await expect(
        tools.updateWorkout({
          event_id: '999',
          name: 'Non-existent',
        })
      ).rejects.toThrow('API request failed');
    });

    it('should return correct response structure', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 135,
        uid: 'uid-135',
        name: 'Structure Test',
        start_date_local: '2024-12-23T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 135,
        uid: 'uid-135',
        name: 'Updated Structure Test',
        start_date_local: '2024-12-23T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '135',
        name: 'Updated Structure Test',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('uid');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('scheduled_for');
      expect(result).toHaveProperty('intervals_icu_url');
      expect(result).toHaveProperty('updated_fields');
      expect(result.intervals_icu_url).toContain('2024-12-23');
    });

    it('should update multiple fields at once', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 136,
        uid: 'uid-136',
        name: 'Multi Update Test',
        start_date_local: '2024-12-16T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 136,
        uid: 'uid-136',
        name: 'New Name',
        start_date_local: '2024-12-25T10:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
      });

      const result = await tools.updateWorkout({
        event_id: '136',
        name: 'New Name',
        scheduled_for: '2024-12-25T10:00:00',
        description: 'New notes',
      });

      expect(result.updated_fields).toContain('name');
      expect(result.updated_fields).toContain('scheduled_for');
      expect(result.updated_fields).toContain('description');
      expect(result.updated_fields).toHaveLength(3);
    });
  });
});
