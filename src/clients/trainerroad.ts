import ical from 'node-ical';
import { parseISO, isWithinInterval, format } from 'date-fns';
import type { PlannedWorkout, TrainerRoadConfig, Discipline } from '../types/index.js';
import { formatDuration } from '../utils/format-units.js';
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
    console.log(`[TrainerRoad] Fetching calendar from ${this.config.calendarUrl}`);

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
   * Get planned workouts within a date range
   */
  async getPlannedWorkouts(
    startDate: string,
    endDate: string
  ): Promise<PlannedWorkout[]> {
    const events = await this.fetchCalendar();

    const start = parseISO(startDate);
    const end = parseISO(`${endDate}T23:59:59`);

    const eventsInRange = events.filter((event) =>
      isWithinInterval(event.start, { start, end })
    );

    return eventsInRange.map((event) => this.normalizeEvent(event));
  }

  /**
   * Get today's planned workouts for a specific timezone
   */
  async getTodayWorkouts(timezone?: string): Promise<PlannedWorkout[]> {
    const today = timezone
      ? new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      : new Date().toISOString().split('T')[0];
    return this.getPlannedWorkouts(today, today);
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

  private normalizeEvent(event: CalendarEvent): PlannedWorkout {
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

    const discipline = this.detectDiscipline(event.summary);

    // Clean up the name by stripping the duration prefix (e.g., "2:00 - Gibbs" → "Gibbs")
    const cleanName = this.stripDurationFromName(event.summary);

    // Detect source based on workout name/description
    const source = this.detectSource(event.summary, event.description);

    // For date-only events, output just the date (yyyy-MM-dd)
    // For date-time events, output full ISO string
    const date =
      event.dateType === 'date'
        ? format(event.start, 'yyyy-MM-dd')
        : event.start.toISOString();

    return {
      id: event.uid,
      date,
      name: cleanName,
      description: event.description,
      expected_tss: parsed.tss,
      expected_if: parsed.if,
      expected_duration: durationMinutes
        ? formatDuration(durationMinutes * 60) // Convert minutes to seconds
        : undefined,
      discipline,
      workout_type: parsed.workoutType,
      intervals: parsed.intervals,
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
   * Detect discipline from workout name
   * Checks for Run/Swim keywords, defaults to Bike
   */
  private detectDiscipline(name: string): Discipline {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('run') || lowerName.includes('running')) {
      return 'Run';
    }
    if (lowerName.includes('swim') || lowerName.includes('swimming')) {
      return 'Swim';
    }
    return 'Bike';
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
    workoutType?: string;
    intervals?: string;
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

    // Try to extract workout type from first line
    const lines = description.split('\n');
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine && !firstLine.match(/^(TSS|IF|Duration)/i)) {
        result.workoutType = firstLine;
      }
    }

    // Extract intervals section if present
    const intervalsMatch = description.match(/(?:Intervals?|Workout Structure)[:\s]+([\s\S]+?)(?:\n\n|$)/i);
    if (intervalsMatch) {
      result.intervals = intervalsMatch[1].trim();
    }

    return result;
  }
}
