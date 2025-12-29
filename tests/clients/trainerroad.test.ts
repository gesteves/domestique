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
        .rejects.toThrow("I couldn't find the TrainerRoad calendar");
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
      expect(result[0].expected_duration).toBe('1:30:00');
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
        const workoutDate = new Date(workout.scheduled_for);
        const now = new Date('2024-12-15T12:00:00Z');
        const daysFromNow = (workoutDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysFromNow).toBeLessThanOrEqual(7);
      });
    });
  });

  describe('sport detection', () => {
    it('should detect Bike sport by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].sport).toBe('Cycling');
    });

    it('should detect Run sport from workout name', async () => {
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

      expect(result[0].sport).toBe('Running');
    });

    it('should detect Swim sport from workout name', async () => {
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

      expect(result[0].sport).toBe('Swimming');
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

      expect(result[0].expected_duration).toBe('0:45:00');
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

      expect(result[0].expected_duration).toBe('2:30:00');
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

      expect(result[0].sport).toBe('Running');
      expect(result[0].expected_duration).toBe('1:00:00');
      expect(result[0].name).toBe('Easy Run');
    });

    it('should parse duration from workout name for all-day events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      // Duration parsed from "2:00 - Gibbs" workout name
      expect(result[0].expected_duration).toBe('2:00:00');
      expect(result[0].name).toBe('Gibbs');
    });

    it('should ignore all-day event durations for non-workout events', async () => {
      // Real example: annotations like "Boise" or plan names like "Off-Season - Increasing FTP"
      // These don't have duration prefixes, so they should be filtered out
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

      // Annotations without duration prefixes should be filtered out
      expect(result).toHaveLength(0);
    });
  });

  describe('source detection', () => {
    it('should detect Zwift source from workout name', async () => {
      const zwiftIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:zwift@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Zwift Race
DESCRIPTION:TSS 80, IF 0.90.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(zwiftIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].source).toBe('zwift');
    });

    it('should detect Zwift source from description', async () => {
      const zwiftIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:zwift@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Group Ride
DESCRIPTION:TSS 60, IF 0.70. Join the Zwift group ride!
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(zwiftIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].source).toBe('zwift');
    });

    it('should detect Zwift source case-insensitively', async () => {
      const zwiftIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:zwift@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - ZWIFT Event
DESCRIPTION:TSS 75, IF 0.85.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(zwiftIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].source).toBe('zwift');
    });

    it('should default to trainerroad source for regular workouts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockIcsData),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result[0].source).toBe('trainerroad');
    });
  });

  describe('date formatting', () => {
    it('should output full datetime for DATE events (shown as midnight in user timezone)', async () => {
      // Events with VALUE=DATE represent all-day events without a specific time
      // These are now shown as midnight in the user's timezone
      const dateOnlyIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:date-only@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Bald
DESCRIPTION:TSS 44, IF 0.66.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(dateOnlyIcs),
      });

      // Pass a timezone to get consistent output
      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      // Should output full datetime in user's timezone (midnight shows as 00:00:00)
      expect(result[0].scheduled_for).toMatch(/^2024-12-16T00:00:00[+-]\d{2}:\d{2}$/);
    });

    it('should output full ISO datetime for DATE-TIME events (specific time set)', async () => {
      // Events with VALUE=DATE-TIME represent events with a specific start time
      const dateTimeIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:date-time@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T160000Z
DTEND;VALUE=DATE-TIME:20241216T173000Z
SUMMARY:1:30 - Eric Min's Festive 500 Christmas Ride
DESCRIPTION:TSS 51. Description: Holiday Spirit.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(dateTimeIcs),
      });

      // Pass a timezone to get consistent output (16:00 UTC = 08:00 PST)
      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      // Should output full ISO datetime in user's timezone
      expect(result[0].scheduled_for).toMatch(/^2024-12-16T08:00:00[+-]\d{2}:\d{2}$/);
    });

    it('should handle mixed DATE and DATE-TIME events correctly', async () => {
      const mixedIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:date-time@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T160000Z
DTEND;VALUE=DATE-TIME:20241216T173000Z
SUMMARY:1:30 - Zwift Group Ride
DESCRIPTION:TSS 51.
END:VEVENT
BEGIN:VEVENT
UID:date-only@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:1:00 - Bald
DESCRIPTION:TSS 44.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mixedIcs),
      });

      // Pass a timezone to get consistent output
      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(2);

      // Find each workout by name
      const zwiftRide = result.find((w) => w.name === 'Zwift Group Ride');
      const baldWorkout = result.find((w) => w.name === 'Bald');

      // DATE-TIME event should have full ISO datetime in user's timezone (16:00 UTC = 08:00 PST)
      expect(zwiftRide?.scheduled_for).toMatch(/^2024-12-16T08:00:00[+-]\d{2}:\d{2}$/);

      // DATE event should have full datetime at midnight in user's timezone
      expect(baldWorkout?.scheduled_for).toMatch(/^2024-12-16T00:00:00[+-]\d{2}:\d{2}$/);
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

  describe('DATE-TIME workout detection', () => {
    it('should detect DATE-TIME events with reasonable duration as workouts', async () => {
      // Event with 2 hour duration (120 minutes) - should be a workout
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:datetime-workout@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T160000Z
DTEND;VALUE=DATE-TIME:20241216T180000Z
SUMMARY:Klammspitze
DESCRIPTION:TSS 81, IF 0.64.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Klammspitze');
      expect(result[0].expected_duration).toBe('2:00:00');
    });

    it('should reject DATE-TIME events with duration >= 1440 minutes as non-workouts', async () => {
      // Event with 24 hour duration (1440 minutes) - should NOT be a workout
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-datetime@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T000000Z
DTEND;VALUE=DATE-TIME:20241217T000000Z
SUMMARY:Rest Day Note
DESCRIPTION:Take it easy today.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(0);
    });

    it('should parse duration from event start/end times for DATE-TIME events', async () => {
      // 90 minute workout
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:duration-test@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T180000Z
DTEND;VALUE=DATE-TIME:20241216T193000Z
SUMMARY:Morning Ride
DESCRIPTION:TSS 60.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].expected_duration).toBe('1:30:00');
    });
  });

  describe('sport detection with TSS', () => {
    it('should detect cycling when description starts with TSS', async () => {
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tss-cycling@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T180000Z
DTEND;VALUE=DATE-TIME:20241216T200000Z
SUMMARY:Klammspitze
DESCRIPTION:TSS 81, IF 0.64. A great endurance workout.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].sport).toBe('Cycling');
    });

    it('should still detect running from name even with TSS in description', async () => {
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:run-with-tss@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T180000Z
DTEND;VALUE=DATE-TIME:20241216T190000Z
SUMMARY:Morning Run
DESCRIPTION:TSS 40. Easy pace.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].sport).toBe('Running');
    });
  });
});
