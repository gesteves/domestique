import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools updateActivity', () => {
  let tools: PlanningTools;
  let mockIntervalsClient: IntervalsClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('updateActivity', () => {
    it('should update activity name', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i12345',
        name: 'Morning Tempo Ride',
      });

      expect(result.activity_id).toBe('i12345');
      expect(result.updated_fields).toEqual(['name']);
      expect(result.intervals_icu_url).toBe('https://intervals.icu/activities/i12345');
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i12345', {
        name: 'Morning Tempo Ride',
      });
    });

    it('should update activity description', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i12345',
        description: 'Felt great on this one!',
      });

      expect(result.activity_id).toBe('i12345');
      expect(result.updated_fields).toEqual(['description']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i12345', {
        description: 'Felt great on this one!',
      });
    });

    it('should update both name and description', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i12345',
        name: 'Race Day',
        description: 'PR on the 10k!',
      });

      expect(result.activity_id).toBe('i12345');
      expect(result.updated_fields).toEqual(['name', 'description']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i12345', {
        name: 'Race Day',
        description: 'PR on the 10k!',
      });
    });

    it('should throw when no fields are provided', async () => {
      await expect(
        tools.updateActivity({ activity_id: 'i12345' })
      ).rejects.toThrow('No fields provided to update. Specify at least one of: name, description');

      expect(mockIntervalsClient.updateActivity).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockRejectedValue(
        new Error('Activity not found')
      );

      await expect(
        tools.updateActivity({ activity_id: 'i99999', name: 'New Name' })
      ).rejects.toThrow('Activity not found');
    });

    it('should allow setting name to empty string', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i12345',
        name: '',
      });

      expect(result.updated_fields).toEqual(['name']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i12345', {
        name: '',
      });
    });

    it('should allow setting description to empty string', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i12345',
        description: '',
      });

      expect(result.updated_fields).toEqual(['description']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i12345', {
        description: '',
      });
    });
  });
});
