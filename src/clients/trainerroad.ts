import ical from 'node-ical';
import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { PlannedWorkout, TrainerRoadConfig, ActivityType } from '../types/index.js';
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
   * - DATE-TIME events: must have a duration less than 1440 minutes (one day)
   */
  private isWorkout(event: CalendarEvent): boolean {
    if (event.dateType === 'date') {
      // DATE events (all-day): check for duration prefix in name
      return this.parseDurationFromName(event.summary) !== undefined;
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

    // Filter out annotations (non-workout events)
    const workouts = eventsInRange.filter((event) => this.isWorkout(event));

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
      description: event.description,
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
