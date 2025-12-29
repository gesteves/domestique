import ical from 'node-ical';
import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { PlannedWorkout, TrainerRoadConfig, ActivityType, Race } from '../types/index.js';
import { formatDuration } from '../utils/format-units.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import { TrainerRoadApiError } from '../errors/index.js';

interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  /** Whether this is a date-only event ('date') or has a specific time ('date-time') */
  dateType: 'date' | 'date-time';
}

export class TrainerRoadClient {
  private config: TrainerRoadConfig;

  constructor(config: TrainerRoadConfig) {
    this.config = config;
  }

  /**
   * Fetch and parse the iCalendar feed (always fresh, no caching)
   */
  private async fetchCalendar(): Promise<CalendarEvent[]> {
    console.log(`[TrainerRoad] Fetching calendar`);

    const errorContext = {
      operation: 'fetch planned workouts',
      resource: 'TrainerRoad calendar',
    };

    let response: Response;
    try {
      response = await fetch(this.config.calendarUrl);
    } catch (error) {
      throw TrainerRoadApiError.networkError(
        errorContext,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw TrainerRoadApiError.fromHttpStatus(response.status, errorContext);
    }

    let icsData: string;
    try {
      icsData = await response.text();
    } catch (error) {
      throw TrainerRoadApiError.networkError(
        errorContext,
        error instanceof Error ? error : undefined
      );
    }

    let parsed: ical.CalendarResponse;
    try {
      parsed = ical.parseICS(icsData);
    } catch (error) {
      throw TrainerRoadApiError.parseError(
        errorContext,
        error instanceof Error ? error : undefined
      );
    }

    const events: CalendarEvent[] = [];

    for (const [_, component] of Object.entries(parsed)) {
      if (component.type === 'VEVENT') {
        const event = component as ical.VEvent;
        if (event.start && event.summary) {
          events.push({
            uid: event.uid || `trainerroad-${event.start.getTime()}`,
            start: event.start,
            end: event.end || event.start,
            summary: event.summary,
            description: event.description,
            dateType: event.datetype || 'date-time',
          });
        }
      }
    }

    return events;
  }

  /**
   * Check if an event is a workout
   * - DATE events: must have a duration prefix in the name (e.g., "2:00 - Workout Name")
   *   AND must not be a race leg (name matches a race event on the same day)
   * - DATE-TIME events: must have a duration less than 1440 minutes (one day)
   * @param event - The calendar event to check
   * @param raceEventNames - Optional set of race event names on the same day (for DATE events)
   */
  private isWorkout(event: CalendarEvent, raceEventNames?: Set<string>): boolean {
    if (event.dateType === 'date') {
      // DATE events (all-day): check for duration prefix in name
      const hasDuration = this.parseDurationFromName(event.summary) !== undefined;
      if (!hasDuration) {
        return false;
      }
      // If there are race events, check if this is a race leg
      if (raceEventNames) {
        const strippedName = this.stripDurationFromName(event.summary);
        if (raceEventNames.has(strippedName)) {
          // This is a race leg (e.g., "0:45 - Escape from Alcatraz" when "Escape from Alcatraz" exists)
          return false;
        }
      }
      return true;
    } else {
      // DATE-TIME events (specific time): check if duration is reasonable (< 1 day)
      if (event.start && event.end) {
        const durationMinutes = (event.end.getTime() - event.start.getTime()) / (1000 * 60);
        return durationMinutes > 0 && durationMinutes < 1440;
      }
      return false;
    }
  }

  /**
   * Find race event names from a list of events.
   * Race events are DATE events (all-day) without a duration prefix in the name.
   * @param events - List of calendar events
   * @returns Set of race event names (for matching against potential race legs)
   */
  private findRaceEventNames(events: CalendarEvent[]): Set<string> {
    const raceNames = new Set<string>();
    for (const event of events) {
      if (event.dateType === 'date' && this.parseDurationFromName(event.summary) === undefined) {
        raceNames.add(event.summary);
      }
    }
    return raceNames;
  }

  /**
   * Get planned workouts within a date range
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @param timezone - IANA timezone to use for date comparison (e.g., 'America/Los_Angeles')
   */
  async getPlannedWorkouts(
    startDate: string,
    endDate: string,
    timezone?: string
  ): Promise<PlannedWorkout[]> {
    const events = await this.fetchCalendar();

    // Filter events by comparing the date
    const eventsInRange = events.filter((event) => {
      // For DATE events (all-day, no specific time), the date is "floating"
      // and represents that calendar day regardless of timezone.
      // node-ical parses DATE events as midnight local time, so we use format()
      // to extract just the date part without timezone conversion.
      if (event.dateType === 'date') {
        const eventDate = format(event.start, 'yyyy-MM-dd');
        return eventDate >= startDate && eventDate <= endDate;
      }

      // For DATE-TIME events (specific time), convert to user's timezone
      // This handles timezone issues where an event at 5 PM local might be the next day in UTC
      const eventDate = timezone
        ? formatInTimeZone(event.start, timezone, 'yyyy-MM-dd')
        : format(event.start, 'yyyy-MM-dd');
      return eventDate >= startDate && eventDate <= endDate;
    });

    // Find race events (all-day events without duration prefix)
    // These are used to exclude race legs from being treated as workouts
    const raceEventNames = this.findRaceEventNames(eventsInRange);

    // Filter out annotations (non-workout events) and race legs
    const workouts = eventsInRange.filter((event) => this.isWorkout(event, raceEventNames));

    return workouts.map((event) => this.normalizeEvent(event, timezone));
  }

  /**
   * Get today's planned workouts for a specific timezone
   */
  async getTodayWorkouts(timezone?: string): Promise<PlannedWorkout[]> {
    const today = timezone
      ? new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      : new Date().toISOString().split('T')[0];
    return this.getPlannedWorkouts(today, today, timezone);
  }

  /**
   * Get upcoming workouts for the next N days
   */
  async getUpcomingWorkouts(days: number): Promise<PlannedWorkout[]> {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    return this.getPlannedWorkouts(
      format(today, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd')
    );
  }

  /**
   * Get upcoming races from today onwards.
   * A race is detected when an all-day event without a duration prefix exists
   * alongside events with duration prefixes that have the same name (race legs).
   * @param timezone - IANA timezone to use for date comparison (e.g., 'America/Los_Angeles')
   */
  async getUpcomingRaces(timezone?: string): Promise<Race[]> {
    const events = await this.fetchCalendar();

    // Get today's date
    const today = timezone
      ? new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      : new Date().toISOString().split('T')[0];

    console.log(`[TrainerRoad] getUpcomingRaces: today=${today}, total events=${events.length}`);

    // Log all events for debugging
    for (const event of events) {
      const eventDate = event.dateType === 'date'
        ? format(event.start, 'yyyy-MM-dd')
        : (timezone ? formatInTimeZone(event.start, timezone, 'yyyy-MM-dd') : format(event.start, 'yyyy-MM-dd'));
      console.log(`[TrainerRoad] Event: dateType=${event.dateType}, date=${eventDate}, summary="${event.summary}"`);
    }

    // Filter to events from today onwards
    const futureEvents = events.filter((event) => {
      if (event.dateType === 'date') {
        const eventDate = format(event.start, 'yyyy-MM-dd');
        return eventDate >= today;
      }
      const eventDate = timezone
        ? formatInTimeZone(event.start, timezone, 'yyyy-MM-dd')
        : format(event.start, 'yyyy-MM-dd');
      return eventDate >= today;
    });

    console.log(`[TrainerRoad] Future events: ${futureEvents.length}`);

    // Find race events and their legs
    return this.findRaces(futureEvents, timezone);
  }

  /**
   * Find races from a list of events.
   * A race is detected when:
   * 1. There's a DATE event (all-day) without a duration prefix
   * 2. There are DATE events with duration prefixes that have the same name (after stripping duration)
   * @param events - List of calendar events
   * @param timezone - IANA timezone for date formatting
   * @returns Array of detected races
   */
  private findRaces(events: CalendarEvent[], timezone?: string): Race[] {
    const races: Race[] = [];

    // Find potential race events (DATE events without duration prefix)
    const raceEvents = events.filter(
      (event) =>
        event.dateType === 'date' &&
        this.parseDurationFromName(event.summary) === undefined
    );

    // Find potential leg events - these are essentially workouts that could be race legs:
    // 1. DATE events (all-day) with duration prefix in the name (e.g., "0:45 - Escape from Alcatraz")
    // 2. DATE-TIME events with start/end times < 1440 minutes and no prefix (regular workout format)
    const legEvents = events.filter((event) => {
      if (event.dateType === 'date') {
        // All-day event with duration prefix
        return this.parseDurationFromName(event.summary) !== undefined;
      } else if (event.dateType === 'date-time') {
        // DATE-TIME event - check if it's a reasonable workout duration (< 12 hours)
        const durationMinutes = (event.end.getTime() - event.start.getTime()) / (1000 * 60);
        return durationMinutes < 720; // Less than 12 hours
      }
      return false;
    });

    console.log(`[TrainerRoad] findRaces: ${raceEvents.length} potential race events, ${legEvents.length} potential leg events`);
    for (const re of raceEvents) {
      console.log(`[TrainerRoad]   Race event: "${re.summary}" on ${format(re.start, 'yyyy-MM-dd')}`);
    }
    for (const le of legEvents) {
      const legDate = le.dateType === 'date'
        ? format(le.start, 'yyyy-MM-dd')
        : (timezone ? formatInTimeZone(le.start, timezone, 'yyyy-MM-dd') : format(le.start, 'yyyy-MM-dd'));
      const legName = le.dateType === 'date'
        ? this.stripDurationFromName(le.summary)
        : le.summary;
      console.log(`[TrainerRoad]   Leg event: "${le.summary}" -> name: "${legName}" on ${legDate} (${le.dateType})`);
    }

    // For each potential race event, check if there are matching legs
    for (const raceEvent of raceEvents) {
      const raceName = raceEvent.summary;
      const raceDate = format(raceEvent.start, 'yyyy-MM-dd');

      // Find all matching leg events on the same day with matching name
      const matchingLegs = legEvents.filter((leg) => {
        // Get leg date - use timezone for DATE-TIME events
        const legDate = leg.dateType === 'date'
          ? format(leg.start, 'yyyy-MM-dd')
          : (timezone ? formatInTimeZone(leg.start, timezone, 'yyyy-MM-dd') : format(leg.start, 'yyyy-MM-dd'));

        // Get leg name - strip duration prefix for DATE events, use as-is for DATE-TIME
        const legName = leg.dateType === 'date'
          ? this.stripDurationFromName(leg.summary)
          : leg.summary;

        const matches = legDate === raceDate && legName === raceName;
        if (matches) {
          console.log(`[TrainerRoad]   Match found: race="${raceName}" leg="${leg.summary}"`);
        }
        return matches;
      });

      if (matchingLegs.length > 0) {
        // Check if any legs are DATE-TIME events - if so, use earliest start time
        const dateTimeLegs = matchingLegs.filter((leg) => leg.dateType === 'date-time');

        let scheduledFor: string;
        if (dateTimeLegs.length > 0) {
          // Find the earliest start time among DATE-TIME legs
          const earliestLeg = dateTimeLegs.reduce((earliest, leg) =>
            leg.start < earliest.start ? leg : earliest
          );
          scheduledFor = timezone
            ? formatInTimeZone(earliestLeg.start, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
            : earliestLeg.start.toISOString();
          console.log(`[TrainerRoad]   Using earliest DATE-TIME leg start: ${scheduledFor}`);
        } else {
          // All legs are DATE events, use midnight
          if (timezone) {
            const dateStr = format(raceEvent.start, 'yyyy-MM-dd');
            const midnightInTz = fromZonedTime(`${dateStr}T00:00:00`, timezone);
            scheduledFor = formatInTimeZone(midnightInTz, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
          } else {
            scheduledFor = `${format(raceEvent.start, 'yyyy-MM-dd')}T00:00:00.000Z`;
          }
        }

        races.push({
          scheduled_for: scheduledFor,
          name: raceName,
          description: this.cleanDescription(raceEvent.description),
          sport: 'Triathlon', // Currently only supporting triathlons
        });
      }
    }

    // Sort races by date
    races.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

    return races;
  }

  private normalizeEvent(event: CalendarEvent, timezone?: string): PlannedWorkout {
    const parsed = this.parseDescription(event.description);

    // Try to get duration from: 1) workout name, 2) description, 3) event times
    let durationMinutes =
      this.parseDurationFromName(event.summary) ?? parsed.duration;
    if (!durationMinutes && event.start && event.end) {
      const eventDuration =
        (event.end.getTime() - event.start.getTime()) / (1000 * 60);
      // Only use event duration if it's reasonable (< 12 hours)
      // All-day events return 1440 minutes which is incorrect
      if (eventDuration < 720) {
        durationMinutes = eventDuration;
      }
    }

    const sport = this.detectSport(event.summary, event.description);

    // Clean up the name by stripping the duration prefix (e.g., "2:00 - Gibbs" → "Gibbs")
    const cleanName = this.stripDurationFromName(event.summary);

    // Detect source based on workout name/description
    const source = this.detectSource(event.summary, event.description);

    // Always output full datetime in user's timezone
    // For date-only events, the time will be midnight (00:00:00)
    // For date-time events, the time will be the scheduled start time
    let date: string;
    if (event.dateType === 'date') {
      // DATE events: the date is "floating" - extract date and output as midnight in user's timezone
      // node-ical parses DATE events as midnight local time, so extract the date part
      const dateStr = format(event.start, 'yyyy-MM-dd');
      if (timezone) {
        // Use fromZonedTime to interpret midnight as being in the target timezone
        // This creates a UTC Date representing midnight in that timezone
        const midnightInTz = fromZonedTime(`${dateStr}T00:00:00`, timezone);
        // Then format it back in that timezone
        date = formatInTimeZone(midnightInTz, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
      } else {
        date = `${dateStr}T00:00:00.000Z`;
      }
    } else {
      // DATE-TIME events: convert to user's timezone
      date = timezone
        ? formatInTimeZone(event.start, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
        : event.start.toISOString();
    }

    return {
      id: event.uid,
      scheduled_for: date,
      name: cleanName,
      description: this.cleanDescription(event.description),
      expected_tss: parsed.tss,
      expected_if: parsed.if,
      expected_duration: durationMinutes
        ? formatDuration(durationMinutes * 60) // Convert minutes to seconds
        : undefined,
      sport,
      source,
    };
  }

  /**
   * Strip duration prefix from workout name (e.g., "2:00 - Gibbs" → "Gibbs")
   */
  private stripDurationFromName(name: string): string {
    // Match patterns like "2:00 - Name" or "1:30 - Name" at the start
    const match = name.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(.+)$/);
    if (match) {
      return match[3];
    }
    return name;
  }

  /**
   * Clean description by removing "Description:" prefix
   */
  private cleanDescription(description: string | undefined): string | undefined {
    if (!description) return undefined;
    return description.replace(/\s*Description:/i, '').trim() || undefined;
  }

  /**
   * Parse duration from workout name (e.g., "2:00 - Gibbs" or "1:30 - Workout")
   */
  private parseDurationFromName(name: string): number | undefined {
    // Match patterns like "2:00 - Name" or "1:30 - Name" at the start
    const match = name.match(/^(\d{1,2}):(\d{2})\s*[-–—]/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      return hours * 60 + minutes;
    }
    return undefined;
  }

  /**
   * Detect sport from workout name and description
   * Uses normalizeActivityType for consistent mapping, defaults to Cycling
   */
  private detectSport(name: string, description?: string): ActivityType {
    // Try normalizing the full workout name first (in case it's an exact match)
    const normalized = normalizeActivityType(name);
    if (normalized !== 'Other') {
      return normalized;
    }

    // Extract keywords from name and try normalizing them
    // Look for common activity type keywords in the name
    const nameLower = name.toLowerCase();
    const keywords = ['run', 'running', 'swim', 'swimming', 'ride', 'cycling', 'bike', 'hike', 'hiking', 'ski', 'skiing', 'row', 'rowing'];
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        const keywordNormalized = normalizeActivityType(keyword);
        if (keywordNormalized !== 'Other') {
          return keywordNormalized;
        }
      }
    }

    // If description starts with "TSS", it's a cycling workout
    if (description?.startsWith('TSS')) {
      return 'Cycling';
    }

    // Default to Cycling for TrainerRoad (most workouts are cycling)
    return 'Cycling';
  }

  /**
   * Detect workout source based on name or description
   * Returns 'zwift' if the name or description contains "Zwift", otherwise 'trainerroad'
   */
  private detectSource(
    name: string,
    description?: string
  ): 'trainerroad' | 'zwift' {
    const lowerName = name.toLowerCase();
    const lowerDescription = description?.toLowerCase() ?? '';
    if (lowerName.includes('zwift') || lowerDescription.includes('zwift')) {
      return 'zwift';
    }
    return 'trainerroad';
  }

  private parseDescription(description?: string): {
    tss?: number;
    if?: number;
    duration?: number;
  } {
    if (!description) {
      return {};
    }

    const result: ReturnType<typeof this.parseDescription> = {};

    // Try to extract TSS (e.g., "TSS: 75" or "TSS 75")
    const tssMatch = description.match(/TSS[:\s]+(\d+(?:\.\d+)?)/i);
    if (tssMatch) {
      result.tss = parseFloat(tssMatch[1]);
    }

    // Try to extract IF (e.g., "IF: 0.85" or "Intensity Factor: 85%")
    const ifMatch = description.match(/(?:IF|Intensity Factor)[:\s]+(\d+(?:\.\d+)?)/i);
    if (ifMatch) {
      let ifValue = parseFloat(ifMatch[1]);
      if (ifValue > 1) {
        ifValue = ifValue / 100;
      }
      result.if = ifValue;
    }

    // Try to extract duration - requires "Duration:" prefix or standalone time format at line start
    const explicitDurationMatch = description.match(
      /Duration[:\s]+(\d+(?::\d{2})?(?::\d{2})?)\s*(?:minutes?|mins?|hours?|hrs?)?/i
    );
    // Match time format like "1:00" or "1:30:00" only at start of line or after newline
    const timeFormatMatch = description.match(/(?:^|\n)(\d{1,2}:\d{2}(?::\d{2})?)/);

    const durationMatch = explicitDurationMatch || timeFormatMatch;
    if (durationMatch) {
      const durationStr = durationMatch[1];
      if (durationStr.includes(':')) {
        const parts = durationStr.split(':').map(Number);
        if (parts.length === 3) {
          result.duration = parts[0] * 60 + parts[1] + parts[2] / 60;
        } else if (parts.length === 2) {
          result.duration = parts[0] * 60 + parts[1];
        }
      } else {
        const value = parseInt(durationStr, 10);
        // Check if units indicate hours
        if (/hours?|hrs?/i.test(durationMatch[0])) {
          result.duration = value * 60;
        } else {
          result.duration = value;
        }
      }
    }

    return result;
  }
}
