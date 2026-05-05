import ical from 'node-ical';
import { format, subDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { PlannedWorkout, TrainerRoadConfig, ActivityType, Race, Annotation, TrainingPhase, TrainingPhaseName } from '../types/index.js';
import { formatDuration } from '../utils/format-units.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import { TrainerRoadApiError } from '../errors/index.js';
import { httpRequestText } from './http.js';
import { categorizeAnnotation } from '../utils/annotation-categorizer.js';
import {
  CachedPhaseMarker,
  loadMarkers,
  rememberMarkers,
} from '../utils/training-phase-cache.js';

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

    const icsData = await httpRequestText({
      url: this.config.calendarUrl,
      context: errorContext,
      toHttpError: (status, ctx, body) => TrainerRoadApiError.fromHttpStatus(status, ctx, body),
      toNetworkError: (ctx, err) => TrainerRoadApiError.networkError(ctx, err),
    });

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
      if (component?.type !== 'VEVENT') continue;

      const event = component as ical.VEvent;
      if (!event.start || !event.summary) {
        console.warn(
          `[TrainerRoad] Skipping VEVENT missing start or summary (uid=${event.uid ?? 'unknown'})`
        );
        continue;
      }
      if (!(event.start instanceof Date)) {
        console.warn(
          `[TrainerRoad] Skipping VEVENT with non-Date start (uid=${event.uid ?? 'unknown'})`
        );
        continue;
      }

      const summary = typeof event.summary === 'string' ? event.summary : event.summary.val;
      const description = event.description == null
        ? undefined
        : typeof event.description === 'string' ? event.description : event.description.val;
      events.push({
        uid: event.uid || `trainerroad-${event.start.getTime()}`,
        start: event.start,
        end: event.end || event.start,
        summary,
        description,
        dateType: event.datetype || 'date-time',
      });
    }

    // Persist any phase markers seen on this fetch so the active phase stays
    // anchorable after the marker rolls out of the iCal lookback window.
    // Best-effort: failures are swallowed and logged, never propagated.
    void this.cachePhaseMarkers(events);

    return events;
  }

  private async cachePhaseMarkers(events: CalendarEvent[]): Promise<void> {
    try {
      const seen: CachedPhaseMarker[] = [];
      for (const event of events) {
        if (!this.isTrainingPhase(event)) continue;
        seen.push({
          date: format(event.start, 'yyyy-MM-dd'),
          name: this.normalizePhaseName(event.summary),
        });
      }
      if (seen.length > 0) {
        await rememberMarkers(seen);
      }
    } catch (error) {
      console.error('[TrainerRoad] Failed to cache phase markers:', error);
    }
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
      ? formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
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
      ? formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
      : new Date().toISOString().split('T')[0];

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

        return legDate === raceDate && legName === raceName;
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

  /**
   * Determine if a calendar event is the umbrella for a race — a DATE
   * (all-day) event without a duration prefix that has at least one matching
   * leg event (same name, same day) registered as a workout/sub-event. Mirrors
   * the matching rules used in findRaces().
   */
  private isRaceUmbrella(
    event: CalendarEvent,
    allEvents: CalendarEvent[],
    timezone?: string
  ): boolean {
    if (event.dateType !== 'date' || this.parseDurationFromName(event.summary) !== undefined) {
      return false;
    }
    const raceName = event.summary;
    const raceDate = format(event.start, 'yyyy-MM-dd');
    return allEvents.some((leg) => {
      if (leg === event) return false;
      if (leg.dateType === 'date') {
        if (this.parseDurationFromName(leg.summary) === undefined) return false;
        const legDate = format(leg.start, 'yyyy-MM-dd');
        const legName = this.stripDurationFromName(leg.summary);
        return legDate === raceDate && legName === raceName;
      } else {
        const durationMinutes = (leg.end.getTime() - leg.start.getTime()) / (1000 * 60);
        if (durationMinutes >= 720) return false;
        const legDate = timezone
          ? formatInTimeZone(leg.start, timezone, 'yyyy-MM-dd')
          : format(leg.start, 'yyyy-MM-dd');
        return legDate === raceDate && leg.summary === raceName;
      }
    });
  }

  private static readonly TRAINING_PHASE_NAMES_LOWER = new Set<string>([
    'base',
    'build',
    'specialty',
    'recovery week',
  ]);

  /**
   * Identify a TrainerRoad training-phase marker — an all-day event whose
   * summary is exactly `Base`, `Build`, `Specialty`, or `Recovery Week`
   * (case-insensitive). These mark the start of a training block and are
   * deterministic strings emitted by TR's plan generator, so no
   * categorization call is needed.
   */
  private isTrainingPhase(event: CalendarEvent): boolean {
    if (event.dateType !== 'date') return false;
    if (this.parseDurationFromName(event.summary) !== undefined) return false;
    return TrainerRoadClient.TRAINING_PHASE_NAMES_LOWER.has(
      event.summary.trim().toLowerCase()
    );
  }

  private normalizePhaseName(summary: string): TrainingPhaseName {
    const trimmed = summary.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'base') return 'Base';
    if (lower === 'build') return 'Build';
    if (lower === 'specialty') return 'Specialty';
    return 'Recovery Week';
  }

  /**
   * Get TrainerRoad training-phase-start markers whose date falls within the
   * given range. Each marker becomes a single-day annotation
   * (`category: 'TrainingPhaseStart'`). Spans are not synthesized — the
   * derived `training_phase` object (see `getCurrentTrainingPhase`) carries
   * the active-phase framing instead.
   *
   * @param startDate - Range start in YYYY-MM-DD format
   * @param endDate - Range end in YYYY-MM-DD format
   */
  async getTrainingPhaseStarts(
    startDate: string,
    endDate: string
  ): Promise<Annotation[]> {
    const events = await this.fetchCalendar();
    return events
      .filter((event) => this.isTrainingPhase(event))
      .map((event): Annotation => {
        const date = format(event.start, 'yyyy-MM-dd');
        const name = this.normalizePhaseName(event.summary);
        return {
          id: event.uid,
          category: 'TrainingPhaseStart',
          name,
          description: this.cleanDescription(event.description),
          start_date: date,
        };
      })
      .filter((a) => a.start_date >= startDate && a.start_date <= endDate)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }

  /**
   * Compute the active TrainerRoad training phase as of `asOfDate`.
   * Combines markers from the current iCal feed with any persisted in the
   * Redis-backed cache so the phase remains anchorable after the start
   * marker has rolled out of the feed's lookback window.
   *
   * Returns `null` if no marker is known on or before `asOfDate`.
   *
   * @param asOfDate - Local YYYY-MM-DD date to evaluate against
   */
  async getCurrentTrainingPhase(
    asOfDate: string
  ): Promise<TrainingPhase | null> {
    const events = await this.fetchCalendar();
    const liveMarkers: CachedPhaseMarker[] = events
      .filter((event) => this.isTrainingPhase(event))
      .map((event) => ({
        date: format(event.start, 'yyyy-MM-dd'),
        name: this.normalizePhaseName(event.summary),
      }));

    const cached = await loadMarkers();
    const byDate = new Map<string, CachedPhaseMarker>();
    for (const m of cached) byDate.set(m.date, m);
    // Live feed wins on conflict (e.g. a marker was edited in TR after caching)
    for (const m of liveMarkers) byDate.set(m.date, m);
    const merged = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    let active: CachedPhaseMarker | undefined;
    let next: CachedPhaseMarker | undefined;
    for (const marker of merged) {
      if (marker.date <= asOfDate) {
        active = marker;
      } else {
        next = marker;
        break;
      }
    }
    if (!active) return null;

    const startedOn = new Date(`${active.date}T00:00:00Z`);
    const asOf = new Date(`${asOfDate}T00:00:00Z`);
    const daysSinceStart = Math.floor(
      (asOf.getTime() - startedOn.getTime()) / (1000 * 60 * 60 * 24)
    );
    const week = Math.floor(daysSinceStart / 7) + 1;

    let endsOn: string | null = null;
    let weeksRemaining: number | null = null;
    if (next) {
      endsOn = next.date;
      const endDate = new Date(`${next.date}T00:00:00Z`);
      const daysRemaining = Math.floor(
        (endDate.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24)
      );
      weeksRemaining = Math.max(0, Math.floor(daysRemaining / 7));
    }

    return {
      name: active.name,
      started_on: active.date,
      ends_on: endsOn,
      week,
      weeks_remaining: weeksRemaining,
    };
  }

  /**
   * Get non-workout calendar annotations whose date span overlaps the given
   * range. TrainerRoad's iCal feed has no category metadata, so anything that
   * isn't a workout and isn't a race (umbrella or leg) is surfaced as a
   * "Note". Multi-day events whose start_date precedes `startDate` but whose
   * end_date overlaps the range are included; the full feed is already in
   * memory after fetchCalendar(), so no lookback query is needed.
   *
   * Phase-start markers (Base/Build/Specialty/Recovery Week) are excluded
   * here and surfaced separately via `getTrainingPhaseStarts`.
   * @param startDate - Range start in YYYY-MM-DD format
   * @param endDate - Range end in YYYY-MM-DD format
   * @param timezone - IANA timezone for DATE-TIME event date extraction
   */
  async getAnnotations(
    startDate: string,
    endDate: string,
    timezone?: string
  ): Promise<Annotation[]> {
    const events = await this.fetchCalendar();

    // Pass `undefined` for raceEventNames so race legs (DATE events with a
    // duration prefix that match a race umbrella's name) stay classified as
    // workouts rather than falling through to annotations. Race umbrellas
    // and training-phase-start markers are filtered separately.
    const inRange = events
      .filter((event) => !this.isWorkout(event))
      .filter((event) => !this.isRaceUmbrella(event, events, timezone))
      .filter((event) => !this.isTrainingPhase(event))
      .map((event) => this.normalizeAnnotation(event, timezone))
      .filter((a): a is Annotation => {
        if (!a) return false;
        const end = a.end_date ?? a.start_date;
        return a.start_date <= endDate && end >= startDate;
      });

    // Optionally classify each annotation via Claude (no-op when
    // ANTHROPIC_API_KEY is unset). Default to 'Note' when categorization is
    // unavailable or returns null, preserving the prior behavior.
    const categories = await Promise.all(
      inRange.map((a) =>
        categorizeAnnotation({ name: a.name, description: a.description })
      )
    );
    return inRange.map((a, i) => ({ ...a, category: categories[i] ?? 'Note' }));
  }

  private normalizeAnnotation(
    event: CalendarEvent,
    timezone?: string
  ): Annotation | null {
    let startDate: string;
    let endDate: string;

    if (event.dateType === 'date') {
      startDate = format(event.start, 'yyyy-MM-dd');
      // iCal DTEND is exclusive for DATE events; the inclusive last day is
      // end - 1 day. node-ical sets end = start when DTEND is omitted, in
      // which case start_date and end_date are the same.
      if (event.end.getTime() > event.start.getTime()) {
        endDate = format(subDays(event.end, 1), 'yyyy-MM-dd');
      } else {
        endDate = startDate;
      }
    } else {
      startDate = timezone
        ? formatInTimeZone(event.start, timezone, 'yyyy-MM-dd')
        : format(event.start, 'yyyy-MM-dd');
      endDate = timezone
        ? formatInTimeZone(event.end, timezone, 'yyyy-MM-dd')
        : format(event.end, 'yyyy-MM-dd');
    }

    return {
      id: event.uid,
      category: 'Note',
      name: event.summary,
      description: this.cleanDescription(event.description),
      start_date: startDate,
      end_date: endDate !== startDate ? endDate : undefined,
    };
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
        // Then format it back in that timezone with offset
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
    // "Endless Pool" workouts are swims, but the name contains no swim keywords.
    if (/\bendless pool\b/i.test(name)) {
      return 'Swimming';
    }

    // Try normalizing the full workout name first (in case it's an exact match)
    const normalized = normalizeActivityType(name);
    if (normalized !== 'Other') {
      return normalized;
    }

    // Extract keywords from name and try normalizing them
    // Look for common activity type keywords in the name
    // Use word boundary matching to avoid false positives (e.g., "row" in "Garrowby")
    const nameLower = name.toLowerCase();
    const keywords = ['run', 'running', 'swim', 'swimming', 'ride', 'cycling', 'bike', 'hike', 'hiking', 'ski', 'skiing', 'row', 'rowing'];
    for (const keyword of keywords) {
      const wordBoundaryRegex = new RegExp(`\\b${keyword}\\b`);
      if (wordBoundaryRegex.test(nameLower)) {
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
