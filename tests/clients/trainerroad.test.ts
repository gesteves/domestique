import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

describe('TrainerRoadClient', () => {
  let client: TrainerRoadClient;
  const mockFetch = vi.fn();

  const mockIcsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TrainerRoad//Calendar//EN
BEGIN:VEVENT
UID:workout-1@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T100000Z
SUMMARY:Sweet Spot Base - Antelope
DESCRIPTION:TSS: 88\\nIF: 0.88\\n\\n3x10 minute Sweet Spot intervals at 88-94% FTP
END:VEVENT
BEGIN:VEVENT
UID:workout-2@trainerroad.com
DTSTART:20241218T090000Z
DTEND:20241218T103000Z
SUMMARY:VO2max - Spencer
DESCRIPTION:TSS: 75\\nIF: 0.95\\n\\n5x3 minute VO2max intervals at 120% FTP
END:VEVENT
BEGIN:VEVENT
UID:workout-3@trainerroad.com
DTSTART:20241220T080000Z
DTEND:20241220T100000Z
SUMMARY:Endurance - Pettit
DESCRIPTION:Duration: 60 minutes\\nTSS: 45\\nRecovery ride at 60-70% FTP
END:VEVENT
END:VCALENDAR`;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    client = new TrainerRoadClient({
      calendarUrl: 'https://www.trainerroad.com/calendar/ical/test-token',
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getPlannedWorkouts', () => {
    it('should fetch and parse iCal data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-20');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Sweet Spot Base - Antelope');
      expect(result[0].source).toBe('trainerroad');
    });

    it('should parse TSS from description', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_tss).toBe(88);
    });

    it('should parse IF from description', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_if).toBe(0.88);
    });

    it('should filter events by date range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-17');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Sweet Spot Base - Antelope');
    });

    it('should always fetch fresh data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      await client.getPlannedWorkouts('2024-12-16', '2024-12-20');
      await client.getPlannedWorkouts('2024-12-16', '2024-12-20');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(client.getPlannedWorkouts('2024-12-16', '2024-12-20'))
        .rejects.toThrow('TrainerRoad calendar fetch failed: 404 Not Found');
    });

    it('should handle empty calendar', async () => {
      const emptyIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TrainerRoad//Calendar//EN
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(emptyIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-20');

      expect(result).toHaveLength(0);
    });
  });

  describe('getTodayWorkouts', () => {
    it('should return workouts for today', async () => {
      const todayIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TrainerRoad//Calendar//EN
BEGIN:VEVENT
UID:workout-today@trainerroad.com
DTSTART:20241215T090000Z
DTEND:20241215T100000Z
SUMMARY:Today's Workout
DESCRIPTION:TSS: 50
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(todayIcs),
      });

      const result = await client.getTodayWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Today's Workout");
    });
  });

  describe('getUpcomingWorkouts', () => {
    it('should return workouts for next N days', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getUpcomingWorkouts(7);

      expect(result.length).toBeGreaterThan(0);
      result.forEach((workout) => {
        const workoutDate = new Date(workout.date);
        const now = new Date('2024-12-15T12:00:00Z');
        const daysFromNow = (workoutDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysFromNow).toBeLessThanOrEqual(7);
      });
    });
  });

  describe('discipline detection', () => {
    it('should detect Bike discipline by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].discipline).toBe('Bike');
    });

    it('should detect Run discipline from workout name', async () => {
      const runIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:run@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T100000Z
SUMMARY:Easy Run - Recovery
DESCRIPTION:TSS: 30
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(runIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].discipline).toBe('Run');
    });

    it('should detect Swim discipline from workout name', async () => {
      const swimIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:swim@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T100000Z
SUMMARY:Endurance Swim - Drills
DESCRIPTION:TSS: 40
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(swimIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].discipline).toBe('Swim');
    });
  });

  describe('duration formatting', () => {
    it('should format short durations as minutes', async () => {
      const shortIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:short@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T093000Z
SUMMARY:Short Ride
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(shortIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].duration_human).toBe('30-minute ride');
    });

    it('should format long durations as hours:minutes', async () => {
      const longIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:long@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T113000Z
SUMMARY:Long Endurance Ride
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(longIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].duration_human).toBe('2:30 ride');
    });

    it('should use discipline-specific suffix', async () => {
      const runIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:run@trainerroad.com
DTSTART:20241216T090000Z
DTEND:20241216T100000Z
SUMMARY:Easy Run
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(runIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].duration_human).toBe('60-minute run');
    });

    it('should calculate duration from event times', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      // First workout is 1 hour (09:00 to 10:00)
      expect(result[0].expected_duration_minutes).toBe(60);
    });
  });

  describe('description parsing', () => {
    it('should handle various TSS formats', async () => {
      const variations = [
        { desc: 'TSS: 75', expected: 75 },
        { desc: 'TSS 80', expected: 80 },
        { desc: 'tss: 65.5', expected: 65.5 },
      ];

      for (const { desc, expected } of variations) {
        const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test@trainerroad.com
DTSTART:20241216T090000Z
SUMMARY:Test
DESCRIPTION:${desc}
END:VEVENT
END:VCALENDAR`;

        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(ics),
        });

        const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');
        expect(result[0].expected_tss).toBe(expected);
      }
    });

    it('should handle various IF formats', async () => {
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test@trainerroad.com
DTSTART:20241216T090000Z
SUMMARY:Test
DESCRIPTION:Intensity Factor: 85%
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');
      expect(result[0].expected_if).toBe(0.85);
    });
  });
});
