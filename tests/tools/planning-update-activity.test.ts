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
      ).rejects.toThrow(
        'No fields provided to update. Specify at least one of: name, description, form_score, form_head_pitch, form_peak_head_roll, form_time_to_neutral, form_set_pacing, form_interval_pacing'
      );

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

    it('should write each FORM Goggles score with the PascalCase API key', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const cases: Array<[
        keyof Parameters<typeof tools.updateActivity>[0],
        string,
        number,
      ]> = [
        ['form_score', 'FormScore', 30],
        ['form_head_pitch', 'FormHeadPitch', 100],
        ['form_peak_head_roll', 'FormPeakHeadRoll', 65],
        ['form_time_to_neutral', 'FormTimeToNeutral', 52],
        ['form_set_pacing', 'FormSetPacing', 89],
        ['form_interval_pacing', 'FormIntervalPacing', 51],
      ];

      for (const [inputKey, apiKey, value] of cases) {
        vi.mocked(mockIntervalsClient.updateActivity).mockClear();

        const result = await tools.updateActivity({
          activity_id: 'i144885455',
          [inputKey]: value,
        } as Parameters<typeof tools.updateActivity>[0]);

        expect(result.updated_fields).toEqual([inputKey]);
        expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i144885455', {
          [apiKey]: value,
        });
      }
    });

    it('should update name and a FORM score together', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i144885455',
        name: 'Lunch Swim',
        form_score: 42,
      });

      expect(result.updated_fields).toEqual(['name', 'form_score']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i144885455', {
        name: 'Lunch Swim',
        FormScore: 42,
      });
    });

    it('should update only FORM scores without throwing on missing name/description', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i144885455',
        form_score: 29,
        form_head_pitch: 58,
        form_peak_head_roll: 65,
        form_time_to_neutral: 52,
        form_set_pacing: 89,
        form_interval_pacing: 51,
      });

      expect(result.updated_fields).toEqual([
        'form_score',
        'form_head_pitch',
        'form_peak_head_roll',
        'form_time_to_neutral',
        'form_set_pacing',
        'form_interval_pacing',
      ]);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i144885455', {
        FormScore: 29,
        FormHeadPitch: 58,
        FormPeakHeadRoll: 65,
        FormTimeToNeutral: 52,
        FormSetPacing: 89,
        FormIntervalPacing: 51,
      });
    });

    it('should allow setting a FORM score to 0', async () => {
      vi.mocked(mockIntervalsClient.updateActivity).mockResolvedValue(undefined);

      const result = await tools.updateActivity({
        activity_id: 'i144885455',
        form_score: 0,
      });

      expect(result.updated_fields).toEqual(['form_score']);
      expect(mockIntervalsClient.updateActivity).toHaveBeenCalledWith('i144885455', {
        FormScore: 0,
      });
    });
  });
});
