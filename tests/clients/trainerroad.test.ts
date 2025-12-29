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

  describe('race event exclusion', () => {
    it('should exclude race legs when a race event exists with same name', async () => {
      // Simulates triathlon race: main event "Escape from Alcatraz" + legs with duration prefixes
      const raceIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:Escape from Alcatraz
DESCRIPTION:Escape from Alcatraz Triathlon
END:VEVENT
BEGIN:VEVENT
UID:swim-leg@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:0:45 - Escape from Alcatraz
DESCRIPTION:Swim leg
END:VEVENT
BEGIN:VEVENT
UID:bike-leg@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:1:00 - Escape from Alcatraz
DESCRIPTION:Bike leg
END:VEVENT
BEGIN:VEVENT
UID:run-leg@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:1:10 - Escape from Alcatraz
DESCRIPTION:Run leg
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(raceIcs),
      });

      const result = await client.getPlannedWorkouts('2026-06-07', '2026-06-07');

      // All legs should be excluded because the race event exists
      expect(result).toHaveLength(0);
    });

    it('should include workouts with duration when no matching race event exists', async () => {
      // Normal workouts should still work
      const workoutIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:workout@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:2:00 - Gibbs
DESCRIPTION:TSS 81, IF 0.64.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(workoutIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Gibbs');
    });

    it('should handle partial name matches correctly (only exact matches excluded)', async () => {
      // "Escape from Alcatraz 2026" is NOT the same as "Escape from Alcatraz"
      const partialMatchIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:Escape from Alcatraz 2026
DESCRIPTION:Race annotation
END:VEVENT
BEGIN:VEVENT
UID:swim-leg@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:0:45 - Escape from Alcatraz
DESCRIPTION:Swim leg
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(partialMatchIcs),
      });

      const result = await client.getPlannedWorkouts('2026-06-07', '2026-06-07');

      // Swim leg should be included because the race event name doesn't exactly match
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Escape from Alcatraz');
    });

    it('should not affect DATE-TIME workout detection', async () => {
      // DATE-TIME events use different detection logic (duration-based)
      const mixedIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event@trainerroad.com
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:Morning Workout
DESCRIPTION:Race annotation
END:VEVENT
BEGIN:VEVENT
UID:datetime-workout@trainerroad.com
DTSTART;VALUE=DATE-TIME:20241216T160000Z
DTEND;VALUE=DATE-TIME:20241216T180000Z
SUMMARY:Morning Workout
DESCRIPTION:TSS 81.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mixedIcs),
      });

      const result = await client.getPlannedWorkouts('2024-12-16', '2024-12-16', 'America/Los_Angeles');

      // DATE-TIME event should still be included (uses different detection logic)
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Morning Workout');
    });

    it('should handle race on different day than workouts', async () => {
      // Race on day 2, workout on day 1 - workout should still be included
      const differentDayIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event@trainerroad.com
DTSTART;VALUE=DATE:20260608
DTEND;VALUE=DATE:20260609
SUMMARY:Escape from Alcatraz
DESCRIPTION:Race day
END:VEVENT
BEGIN:VEVENT
UID:workout@trainerroad.com
DTSTART;VALUE=DATE:20260607
DTEND;VALUE=DATE:20260608
SUMMARY:0:45 - Escape from Alcatraz
DESCRIPTION:Warmup workout
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(differentDayIcs),
      });

      // Query only June 7 - should include the workout
      const result = await client.getPlannedWorkouts('2026-06-07', '2026-06-07');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Escape from Alcatraz');
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

  describe('getUpcomingRaces', () => {
    it('should detect a race when there is an all-day event with matching workout legs', async () => {
      // Mock current date to 2024-12-15
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event
DTSTART;VALUE=DATE:20261207
DTEND;VALUE=DATE:20261208
SUMMARY:Escape from Alcatraz
DESCRIPTION:Race day!
END:VEVENT
BEGIN:VEVENT
UID:swim-leg
DTSTART;VALUE=DATE:20261207
DTEND;VALUE=DATE:20261208
SUMMARY:0:30 - Escape from Alcatraz
DESCRIPTION:Swim leg
END:VEVENT
BEGIN:VEVENT
UID:bike-leg
DTSTART;VALUE=DATE:20261207
DTEND;VALUE=DATE:20261208
SUMMARY:1:10 - Escape from Alcatraz
DESCRIPTION:Bike leg
END:VEVENT
BEGIN:VEVENT
UID:run-leg
DTSTART;VALUE=DATE:20261207
DTEND;VALUE=DATE:20261208
SUMMARY:0:50 - Escape from Alcatraz
DESCRIPTION:Run leg
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Escape from Alcatraz');
      expect(result[0].description).toBe('Race day!');
      expect(result[0].sport).toBe('Triathlon');
      expect(result[0].scheduled_for).toBe('2026-12-07T00:00:00-08:00');

      vi.useRealTimers();
    });

    it('should return empty array when there are no races', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:workout1
DTSTART;VALUE=DATE-TIME:20241216T090000Z
DTEND;VALUE=DATE-TIME:20241216T100000Z
SUMMARY:Sweet Spot Intervals
DESCRIPTION:TSS 75. Power workout.
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should not detect a race when all-day event has no matching workout legs', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      // All-day event without matching workout legs (different name)
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1
DTSTART;VALUE=DATE:20241216
DTEND;VALUE=DATE:20241217
SUMMARY:Race Day Off
DESCRIPTION:Day off for race prep
END:VEVENT
BEGIN:VEVENT
UID:workout1
DTSTART;VALUE=DATE-TIME:20241216T090000Z
DTEND;VALUE=DATE-TIME:20241216T100000Z
SUMMARY:0:30 - Different Workout
DESCRIPTION:Not related
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should not include past races', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      // Race in the past (December 10)
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:past-race
DTSTART;VALUE=DATE:20241210
DTEND;VALUE=DATE:20241211
SUMMARY:Past Triathlon
DESCRIPTION:Already happened
END:VEVENT
BEGIN:VEVENT
UID:past-swim
DTSTART;VALUE=DATE-TIME:20241210T080000Z
DTEND;VALUE=DATE-TIME:20241210T083000Z
SUMMARY:0:30 - Past Triathlon
DESCRIPTION:Swim
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should include races happening today', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      // Race today (December 15) - legs are DATE events with duration prefix
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:today-race
DTSTART;VALUE=DATE:20241215
DTEND;VALUE=DATE:20241216
SUMMARY:Today Triathlon
DESCRIPTION:Race day today!
END:VEVENT
BEGIN:VEVENT
UID:today-swim
DTSTART;VALUE=DATE:20241215
DTEND;VALUE=DATE:20241216
SUMMARY:0:30 - Today Triathlon
DESCRIPTION:Swim leg
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Today Triathlon');

      vi.useRealTimers();
    });

    it('should handle race without description', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      // Legs are DATE events with duration prefix
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-no-desc
DTSTART;VALUE=DATE:20241220
DTEND;VALUE=DATE:20241221
SUMMARY:Triathlon XYZ
END:VEVENT
BEGIN:VEVENT
UID:swim-leg
DTSTART;VALUE=DATE:20241220
DTEND;VALUE=DATE:20241221
SUMMARY:0:30 - Triathlon XYZ
DESCRIPTION:Swim
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Triathlon XYZ');
      expect(result[0].description).toBeUndefined();

      vi.useRealTimers();
    });

    it('should also detect race legs as DATE-TIME events and use earliest start time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      // Race legs as DATE-TIME events (no duration prefix in name)
      // Swim at 8am, Bike at 9am, Run at 11am - should use 8am (earliest)
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:race-event
DTSTART;VALUE=DATE:20241220
DTEND;VALUE=DATE:20241221
SUMMARY:Date Time Race
DESCRIPTION:A race with DATE-TIME legs
END:VEVENT
BEGIN:VEVENT
UID:bike-leg
DTSTART;VALUE=DATE-TIME:20241220T170000Z
DTEND;VALUE=DATE-TIME:20241220T180000Z
SUMMARY:Date Time Race
DESCRIPTION:Bike leg
END:VEVENT
BEGIN:VEVENT
UID:swim-leg
DTSTART;VALUE=DATE-TIME:20241220T160000Z
DTEND;VALUE=DATE-TIME:20241220T163000Z
SUMMARY:Date Time Race
DESCRIPTION:Swim leg
END:VEVENT
BEGIN:VEVENT
UID:run-leg
DTSTART;VALUE=DATE-TIME:20241220T190000Z
DTEND;VALUE=DATE-TIME:20241220T200000Z
SUMMARY:Date Time Race
DESCRIPTION:Run leg
END:VEVENT
END:VCALENDAR`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ics),
      });

      const result = await client.getUpcomingRaces('America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Date Time Race');
      // 16:00 UTC = 08:00 PST (earliest leg start)
      expect(result[0].scheduled_for).toBe('2024-12-20T08:00:00-08:00');

      vi.useRealTimers();
    });
  });
});
