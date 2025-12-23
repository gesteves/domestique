import ical from 'node-ical';
import { parseISO, isWithinInterval, format } from 'date-fns';
import type { PlannedWorkout, TrainerRoadConfig, Discipline } from '../types/index.js';

interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
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
    const response = await fetch(this.config.calendarUrl);
    if (!response.ok) {
      throw new Error(
        `TrainerRoad calendar fetch failed: ${response.status} ${response.statusText}`
      );
    }

    const icsData = await response.text();
    const parsed = ical.parseICS(icsData);

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
   * Get today's planned workouts
   */
  async getTodayWorkouts(): Promise<PlannedWorkout[]> {
    const today = new Date().toISOString().split('T')[0];
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

    // Calculate duration from event times if not in description
    let durationMinutes = parsed.duration;
    if (!durationMinutes && event.start && event.end) {
      durationMinutes = (event.end.getTime() - event.start.getTime()) / (1000 * 60);
    }

    const discipline = this.detectDiscipline(event.summary);
    const durationHuman = durationMinutes
      ? this.formatDuration(durationMinutes, discipline)
      : undefined;

    return {
      id: event.uid,
      date: event.start.toISOString(),
      name: event.summary,
      description: event.description,
      expected_tss: parsed.tss,
      expected_if: parsed.if,
      expected_duration_minutes: durationMinutes,
      duration_human: durationHuman,
      discipline,
      workout_type: parsed.workoutType,
      intervals: parsed.intervals,
      source: 'trainerroad',
    };
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
   * Format duration as human-readable string
   * Under 90 minutes: "45-minute ride"
   * 90+ minutes: "1:30 ride"
   */
  private formatDuration(minutes: number, discipline: Discipline): string {
    const suffix = discipline === 'Bike' ? 'ride' : discipline.toLowerCase();

    if (minutes < 90) {
      return `${Math.round(minutes)}-minute ${suffix}`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}:${mins.toString().padStart(2, '0')} ${suffix}`;
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
