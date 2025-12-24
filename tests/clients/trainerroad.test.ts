import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

describe('TrainerRoadClient', () => {
  let client: TrainerRoadClient;
  const mockFetch = vi.fn();

  // Real TrainerRoad calendar format based on actual data
  const mockIcsData = `BEGIN:VCALENDAR
PRODID:-// Trainer Road LLC// Cycling// EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
TRANSP:TRANSPARENT
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
DTSTAMP:20241215T120000Z
UID:workout-1@trainerroad.com
STATUS:CONFIRMED
SUMMARY:2:00 - Gibbs
DESCRIPTION:TSS 81, IF 0.64, kJ(Cal) 1263.  Description: Gibbs consists of 2 hours of aerobic Endurance riding spent between 60-70% FTP.
END:VEVENT
BEGIN:VEVENT
TRANSP:TRANSPARENT
DTSTART;VALUE=DATE:20241218
DTEND;VALUE=DATE:20241219
DTSTAMP:20241215T120000Z
UID:workout-2@trainerroad.com
STATUS:CONFIRMED
SUMMARY:1:30 - Heng Shan
DESCRIPTION:TSS 119, IF 0.89, kJ(Cal) 1186.  Description: Heng Shan consists of 4 sets of short efforts lasting between 1-4 minutes at 96-117% FTP with very short, 30-second recoveries between intervals.
END:VEVENT
BEGIN:VEVENT
TRANSP:TRANSPARENT
DTSTART;VALUE=DATE:20241220
DTEND;VALUE=DATE:20241221
DTSTAMP:20241215T120000Z
UID:workout-3@trainerroad.com
STATUS:CONFIRMED
SUMMARY:1:00 - Denali
DESCRIPTION:TSS 77, IF 0.88, kJ(Cal) 723.  Description: Denali is 4x6-minute intervals at 105-109% FTP with 6-minute recoveries following each interval.
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
      expect(result[0].name).toBe('Gibbs');
      expect(result[0].source).toBe('trainerroad');
    });

    it('should parse TSS from description', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_tss).toBe(81);
    });

    it('should parse IF from description', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_if).toBe(0.64);
    });

    it('should filter events by date range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-17');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Gibbs');
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
PRODID:-// Trainer Road LLC// Cycling// EN
BEGIN:VEVENT
UID:workout-today@trainerroad.com
DTSTART;VALUE=DATE:20241215
DTEND;VALUE=DATE:20241216
SUMMARY:1:30 - Heng Shan
DESCRIPTION:TSS 119, IF 0.89, kJ(Cal) 1186.  Description: Heng Shan consists of 4 sets of short efforts.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(todayIcs),
      });

      const result = await client.getTodayWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Heng Shan');
      expect(result[0].expected_duration_minutes).toBe(90);
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
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:0:45 - Easy Run
DESCRIPTION:TSS 30, IF 0.65.
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
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:0:30 - Endurance Swim
DESCRIPTION:TSS 40, IF 0.70.
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
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:0:45 - Short Workout
DESCRIPTION:TSS 30, IF 0.60.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(shortIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_duration_minutes).toBe(45);
      expect(result[0].expected_duration_human).toBe('0:45:00');
      expect(result[0].name).toBe('Short Workout');
    });

    it('should format long durations as hours:minutes:seconds', async () => {
      const longIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:long@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:2:30 - Apikuni
DESCRIPTION:TSS 93, IF 0.61, kJ(Cal) 1544.  Description: Apikuni is 2.5 hours of aerobic Endurance riding.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(longIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].expected_duration_minutes).toBe(150);
      expect(result[0].expected_duration_human).toBe('2:30:00');
      expect(result[0].name).toBe('Apikuni');
    });

    it('should strip duration from name for runs too', async () => {
      const runIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:run@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Easy Run
DESCRIPTION:TSS 40, IF 0.65.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(runIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].discipline).toBe('Run');
      expect(result[0].expected_duration_human).toBe('1:00:00');
      expect(result[0].name).toBe('Easy Run');
    });

    it('should parse duration from workout name for all-day events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      // Duration parsed from "2:00 - Gibbs" workout name
      expect(result[0].expected_duration_minutes).toBe(120);
      expect(result[0].expected_duration_human).toBe('2:00:00');
      expect(result[0].name).toBe('Gibbs');
    });

    it('should ignore all-day event durations for non-workout events', async () => {
      // Real example: annotations like "Boise" or plan names like "Off-Season - Increasing FTP"
      const annotationIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:annotation@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241219
SUMMARY:Boise
DESCRIPTION: Description: Boise
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(annotationIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      // Should not use multi-day duration from annotation event
      expect(result[0].expected_duration_minutes).toBeUndefined();
      expect(result[0].expected_duration_human).toBeUndefined();
    });
  });

  describe('description parsing', () => {
    it('should parse real TrainerRoad description format', async () => {
      // Real format: "TSS 81, IF 0.64, kJ(Cal) 1263.  Description: ..."
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:2:00 - Gibbs
DESCRIPTION:TSS 81, IF 0.64, kJ(Cal) 1263.  Description: Gibbs consists of 2 hours of aerobic Endurance riding spent between 60-70% FTP.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');
      expect(result[0].expected_tss).toBe(81);
      expect(result[0].expected_if).toBe(0.64);
    });

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
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Test Workout
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
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Test Workout
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
