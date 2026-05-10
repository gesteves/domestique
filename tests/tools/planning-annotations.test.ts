import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools annotation lifecycle', () => {
  let tools: PlanningTools;
  let mockIntervalsClient: IntervalsClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createAnnotation', () => {
    it('creates a single-day SeasonStart with the domestique tag and no end_date', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 200,
        uid: 'uid-200',
        name: '2025 season',
        start_date_local: '2025-01-01',
        type: 'Note',
        category: 'SEASON_START',
      });

      const result = await tools.createAnnotation({
        category: 'season_start',
        start_date: '2025-01-01',
        name: '2025 season',
      });

      expect(result.category).toBe('SeasonStart');
      expect(result.start_date).toBe('2025-01-01');
      expect(result.end_date).toBeUndefined();
      expect(result.intervals_icu_url).toContain('2025-01-01');
      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'SEASON_START',
          start_date_local: '2025-01-01T00:00:00',
          tags: ['domestique'],
        })
      );
      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.not.objectContaining({ end_date_local: expect.anything() })
      );
    });

    it('creates a multi-day Sick annotation with end_date', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 201,
        uid: 'uid-201',
        name: 'Flu',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
      });

      const result = await tools.createAnnotation({
        category: 'sick',
        start_date: '2024-12-16',
        end_date: '2024-12-18',
        name: 'Flu',
      });

      expect(result.category).toBe('Sick');
      expect(result.end_date).toBe('2024-12-18');
      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'SICK',
          start_date_local: '2024-12-16T00:00:00',
          end_date_local: '2024-12-18T00:00:00',
          tags: ['domestique'],
        })
      );
    });

    it('drops end_date when it equals start_date (single-day input)', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 202,
        uid: 'uid-202',
        name: 'Holiday',
        start_date_local: '2024-12-25',
        type: 'Note',
        category: 'HOLIDAY',
      });

      await tools.createAnnotation({
        category: 'holiday',
        start_date: '2024-12-25',
        end_date: '2024-12-25',
      });

      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.not.objectContaining({ end_date_local: expect.anything() })
      );
    });

    it('rejects an end_date earlier than start_date', async () => {
      await expect(
        tools.createAnnotation({
          category: 'sick',
          start_date: '2024-12-18',
          end_date: '2024-12-16',
        })
      ).rejects.toThrow('end_date must be on or after start_date');
      expect(mockIntervalsClient.createEvent).not.toHaveBeenCalled();
    });

    it('falls back to a default name when none is provided', async () => {
      vi.mocked(mockIntervalsClient.createEvent).mockResolvedValue({
        id: 203,
        uid: 'uid-203',
        name: 'Note',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'NOTE',
      });

      await tools.createAnnotation({
        category: 'note',
        start_date: '2024-12-16',
        description: 'Felt sluggish today',
      });

      expect(mockIntervalsClient.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Note' })
      );
    });
  });

  describe('updateAnnotation', () => {
    it('updates name and description on a Domestique-tagged annotation', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 300,
        uid: 'uid-300',
        name: 'Sick',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 300,
        uid: 'uid-300',
        name: 'Flu',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
        tags: ['domestique'],
      });

      const result = await tools.updateAnnotation({
        event_id: '300',
        name: 'Flu',
        description: 'Fever, body aches',
      });

      expect(result.name).toBe('Flu');
      expect(result.updated_fields).toEqual(expect.arrayContaining(['name', 'description']));
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '300',
        expect.objectContaining({
          name: 'Flu',
          description: 'Fever, body aches',
          tags: ['domestique'],
        })
      );
    });

    it('changes category from note to sick', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 301,
        uid: 'uid-301',
        name: 'Off day',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'NOTE',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 301,
        uid: 'uid-301',
        name: 'Off day',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
        tags: ['domestique'],
      });

      const result = await tools.updateAnnotation({
        event_id: '301',
        category: 'sick',
      });

      expect(result.category).toBe('Sick');
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '301',
        expect.objectContaining({ category: 'SICK' })
      );
    });

    it('clears end_date when an empty string is passed', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 302,
        uid: 'uid-302',
        name: 'Trip',
        start_date_local: '2024-12-20',
        end_date_local: '2024-12-25',
        type: 'Note',
        category: 'HOLIDAY',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.updateEvent).mockResolvedValue({
        id: 302,
        uid: 'uid-302',
        name: 'Trip',
        start_date_local: '2024-12-20',
        type: 'Note',
        category: 'HOLIDAY',
        tags: ['domestique'],
      });

      const result = await tools.updateAnnotation({
        event_id: '302',
        end_date: '',
      });

      expect(result.end_date).toBeUndefined();
      expect(mockIntervalsClient.updateEvent).toHaveBeenCalledWith(
        '302',
        expect.objectContaining({ end_date_local: null })
      );
    });

    it('refuses to update annotation without domestique tag', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 303,
        uid: 'uid-303',
        name: 'User-made note',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'NOTE',
        tags: ['manual'],
      });

      await expect(
        tools.updateAnnotation({ event_id: '303', name: 'Hijack' })
      ).rejects.toThrow('not created by Domestique');
      expect(mockIntervalsClient.updateEvent).not.toHaveBeenCalled();
    });

    it('throws when no fields are provided', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 304,
        uid: 'uid-304',
        name: 'Sick',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
        tags: ['domestique'],
      });

      await expect(tools.updateAnnotation({ event_id: '304' })).rejects.toThrow(
        'No fields provided to update'
      );
      expect(mockIntervalsClient.updateEvent).not.toHaveBeenCalled();
    });
  });

  describe('deleteAnnotation', () => {
    it('deletes a Domestique-tagged annotation', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 400,
        uid: 'uid-400',
        name: 'Sick',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'SICK',
        tags: ['domestique'],
      });
      vi.mocked(mockIntervalsClient.deleteEvent).mockResolvedValue(undefined);

      const result = await tools.deleteAnnotation('400');

      expect(result.deleted).toBe(true);
      expect(mockIntervalsClient.deleteEvent).toHaveBeenCalledWith('400');
    });

    it('refuses to delete annotation without domestique tag', async () => {
      vi.mocked(mockIntervalsClient.getEvent).mockResolvedValue({
        id: 401,
        uid: 'uid-401',
        name: 'User-made note',
        start_date_local: '2024-12-16',
        type: 'Note',
        category: 'NOTE',
        tags: ['manual'],
      });

      await expect(tools.deleteAnnotation('401')).rejects.toThrow(
        'not created by Domestique'
      );
      expect(mockIntervalsClient.deleteEvent).not.toHaveBeenCalled();
    });
  });
});
