import { addDays, format } from 'date-fns';
import { IntervalsClient } from '../clients/intervals.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateStringInTimezone } from '../utils/date-parser.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar, generateSyncHint } from '../utils/workout-utils.js';
import type {
  PlannedWorkout,
  ActivityType,
  Race,
  CreateRunWorkoutInput,
  CreateCyclingWorkoutInput,
  CreateWorkoutResponse,
  SyncTRRunsResult,
  SetWorkoutIntervalsInput,
  SetWorkoutIntervalsResponse,
} from '../types/index.js';
import type { GetUpcomingWorkoutsInput } from './types.js';

/**
 * Response type for upcoming workouts with optional hints.
 */
export interface UpcomingWorkoutsResponse {
  workouts: PlannedWorkout[];
  /** Optional hint for the LLM about TR runs that can be synced */
  _instructions?: string;
}

export class PlanningTools {
  constructor(
    private intervals: IntervalsClient,
    private trainerroad: TrainerRoadClient | null
  ) {}

  /**
   * Get upcoming planned workouts from both calendars
   */
  async getUpcomingWorkouts(params: GetUpcomingWorkoutsInput): Promise<UpcomingWorkoutsResponse> {
    const { oldest, newest, sport } = params;

    // Use athlete's timezone for date calculations
    const timezone = await this.intervals.getAthleteTimezone();

    // Parse the oldest date, defaulting to "today"
    const startDateStr = parseDateStringInTimezone(oldest ?? 'today', timezone, 'oldest');

    // Parse newest or default to 7 days from oldest
    let endDateStr: string;
    if (newest) {
      endDateStr = parseDateStringInTimezone(newest, timezone, 'newest');
    } else {
      const startDate = new Date(startDateStr + 'T00:00:00');
      const endDate = addDays(startDate, 7);
      endDateStr = format(endDate, 'yyyy-MM-dd');
    }

    // Fetch from both sources in parallel
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getPlannedWorkouts(startDateStr, endDateStr, timezone).catch((e) => {
        console.error('Error fetching TrainerRoad workouts:', e);
        return [];
      }) ?? Promise.resolve([]),
      this.intervals.getPlannedEvents(startDateStr, endDateStr).catch((e) => {
        console.error('Error fetching Intervals.icu events:', e);
        return [];
      }),
    ]);

    // Merge, deduplicate, and sort by date
    let workouts = this.mergeWorkouts(trainerroadWorkouts, intervalsWorkouts);

    // Filter by sport if specified
    if (sport) {
      const sportMap: Record<string, ActivityType> = {
        cycling: 'Cycling',
        running: 'Running',
        swimming: 'Swimming',
        skiing: 'Skiing',
        hiking: 'Hiking',
        rowing: 'Rowing',
        strength: 'Strength',
      };
      const activityType = sportMap[sport];
      workouts = workouts.filter((w) => w.sport === activityType);
    }

    const sortedWorkouts = workouts.sort(
      (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
    );

    // Generate proactive hint if there are TR runs without matching ICU workouts
    const hint = generateSyncHint(trainerroadWorkouts, intervalsWorkouts);

    return {
      workouts: sortedWorkouts,
      ...(hint && { _instructions: hint }),
    };
  }

  /**
   * Merge workouts from both sources, avoiding duplicates
   */
  private mergeWorkouts(
    trainerroad: PlannedWorkout[],
    intervals: PlannedWorkout[]
  ): PlannedWorkout[] {
    const merged = [...trainerroad];

    for (const intervalsWorkout of intervals) {
      const isDuplicate = trainerroad.some((tr) =>
        areWorkoutsSimilar(tr, intervalsWorkout)
      );
      if (!isDuplicate) {
        merged.push(intervalsWorkout);
      }
    }

    return merged;
  }

  /**
   * Get upcoming races from the TrainerRoad calendar.
   * A race is detected when an all-day event exists alongside workout legs with the same name.
   */
  async getUpcomingRaces(): Promise<Race[]> {
    if (!this.trainerroad) {
      return [];
    }

    try {
      // Use athlete's timezone for date calculations
      const timezone = await this.intervals.getAthleteTimezone();
      return await this.trainerroad.getUpcomingRaces(timezone);
    } catch (error) {
      console.error('Error fetching upcoming races:', error);
      return [];
    }
  }

  // ============================================
  // Workout Creation & Sync Operations
  // ============================================

  /**
   * Create a structured running workout in Intervals.icu.
   * The workout will be tagged with 'domestique' for tracking.
   */
  async createRunWorkout(input: CreateRunWorkoutInput): Promise<CreateWorkoutResponse> {
    const timezone = await this.intervals.getAthleteTimezone();

    let scheduledDate: string;

    // Check if input already has a time component (ISO datetime format)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.scheduled_for)) {
      // Preserve the full datetime
      scheduledDate = input.scheduled_for;
    } else {
      // Parse the date string and add midnight
      const dateOnly = parseDateStringInTimezone(
        input.scheduled_for,
        timezone,
        'scheduled_for'
      );
      scheduledDate = `${dateOnly}T00:00:00`;
    }

    // Create the event via API
    const response = await this.intervals.createEvent({
      name: input.name,
      description: (input.description ? `${input.description}\n\n` : '') + input.workout_doc,
      type: 'Run',
      category: 'WORKOUT',
      start_date_local: scheduledDate,
      tags: [DOMESTIQUE_TAG],
      external_id: input.trainerroad_uid,
    });

    return {
      id: response.id,
      uid: response.uid,
      name: response.name,
      scheduled_for: response.start_date_local,
      intervals_icu_url: `https://intervals.icu/calendar/${scheduledDate.split('T')[0]}`,
    };
  }

  /**
   * Create a structured cycling workout in Intervals.icu.
   * The workout will be tagged with 'domestique' for tracking.
   */
  async createCyclingWorkout(input: CreateCyclingWorkoutInput): Promise<CreateWorkoutResponse> {
    const timezone = await this.intervals.getAthleteTimezone();

    let scheduledDate: string;

    // Check if input already has a time component (ISO datetime format)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.scheduled_for)) {
      // Preserve the full datetime
      scheduledDate = input.scheduled_for;
    } else {
      // Parse the date string and add midnight
      const dateOnly = parseDateStringInTimezone(
        input.scheduled_for,
        timezone,
        'scheduled_for'
      );
      scheduledDate = `${dateOnly}T00:00:00`;
    }

    // Create the event via API
    const response = await this.intervals.createEvent({
      name: input.name,
      description: (input.description ? `${input.description}\n\n` : '') + input.workout_doc,
      type: 'Ride',
      category: 'WORKOUT',
      start_date_local: scheduledDate,
      tags: [DOMESTIQUE_TAG],
    });

    return {
      id: response.id,
      uid: response.uid,
      name: response.name,
      scheduled_for: response.start_date_local,
      intervals_icu_url: `https://intervals.icu/calendar/${scheduledDate.split('T')[0]}`,
    };
  }

  /**
   * Delete a Domestique-created workout from Intervals.icu.
   * Only deletes workouts tagged with 'domestique'.
   */
  async deleteWorkout(eventId: string): Promise<{ deleted: boolean; message: string }> {
    // First, verify the workout exists and has the domestique tag
    const event = await this.intervals.getEvent(eventId);

    if (!event.tags?.includes(DOMESTIQUE_TAG)) {
      throw new Error(
        `Cannot delete this workout: it was not created by Domestique. ` +
        `Only workouts tagged with "${DOMESTIQUE_TAG}" can be deleted via this tool.`
      );
    }

    await this.intervals.deleteEvent(eventId);

    return {
      deleted: true,
      message: `Successfully deleted workout "${event.name}"`,
    };
  }

  /**
   * Sync TrainerRoad running workouts to Intervals.icu.
   * Identifies TR runs that need syncing and orphaned Domestique workouts.
   */
  async syncTRRuns(params: {
    oldest?: string;
    newest?: string;
    dry_run?: boolean;
  }): Promise<SyncTRRunsResult> {
    const result: SyncTRRunsResult = {
      tr_runs_found: 0,
      orphans_deleted: 0,
      runs_to_sync: [],
      deleted: [],
      errors: [],
    };

    if (!this.trainerroad) {
      result.errors.push('TrainerRoad is not configured');
      return result;
    }

    const timezone = await this.intervals.getAthleteTimezone();

    // Parse date range
    const startDate = parseDateStringInTimezone(
      params.oldest ?? 'today',
      timezone,
      'oldest'
    );
    const endDate = params.newest
      ? parseDateStringInTimezone(params.newest, timezone, 'newest')
      : format(addDays(new Date(startDate), 30), 'yyyy-MM-dd');

    // 1. Get TR running workouts
    const trWorkouts = await this.trainerroad.getPlannedWorkouts(startDate, endDate, timezone);
    const trRuns = trWorkouts.filter((w) => w.sport === 'Running');
    result.tr_runs_found = trRuns.length;

    // 2. Get existing Domestique-created workouts in Intervals.icu
    const domestiqueWorkouts = await this.intervals.getEventsByTag(
      DOMESTIQUE_TAG,
      startDate,
      endDate
    );

    // 3. Find TR runs that need syncing (no matching ICU workout with same external_id)
    const domestiqueExternalIds = new Set(
      domestiqueWorkouts.map((d) => d.external_id).filter(Boolean)
    );

    for (const trRun of trRuns) {
      if (!domestiqueExternalIds.has(trRun.id)) {
        result.runs_to_sync.push({
          tr_uid: trRun.id,
          tr_name: trRun.name,
          tr_description: trRun.description,
          scheduled_for: trRun.scheduled_for,
          expected_tss: trRun.expected_tss,
          expected_duration: trRun.expected_duration,
        });
      }
    }

    // 4. Find orphaned Domestique workouts (external_id no longer in TR)
    const trIds = new Set(trRuns.map((tr) => tr.id));
    const orphans = domestiqueWorkouts.filter(
      (d) => d.external_id && !trIds.has(d.external_id)
    );

    // 5. Delete orphans if not dry run
    if (!params.dry_run) {
      for (const orphan of orphans) {
        try {
          await this.intervals.deleteEvent(orphan.id);
          result.orphans_deleted++;
          result.deleted.push({
            name: orphan.name,
            reason: 'TrainerRoad workout no longer exists',
          });
        } catch (error) {
          result.errors.push(`Failed to delete orphan "${orphan.name}": ${error}`);
        }
      }
    } else {
      // In dry run mode, report what would be deleted
      for (const orphan of orphans) {
        result.deleted.push({
          name: orphan.name,
          reason: 'TrainerRoad workout no longer exists (dry run - not deleted)',
        });
      }
    }

    return result;
  }

  /**
   * Set intervals on a completed activity in Intervals.icu.
   *
   * This tool is used to define workout intervals on a completed activity
   * based on data parsed from a TrainerRoad workout screenshot.
   *
   * Intervals.icu will recalculate all metrics (power, HR, cadence, etc.)
   * from the recorded activity data based on the provided time ranges.
   */
  async setWorkoutIntervals(input: SetWorkoutIntervalsInput): Promise<SetWorkoutIntervalsResponse> {
    const { activity_id, intervals, replace_existing_intervals = true } = input;

    if (!intervals.length) {
      throw new Error('At least one interval is required');
    }

    // Validate that all intervals have required fields
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      if (typeof interval.start_time !== 'number' || interval.start_time < 0) {
        throw new Error(`Interval ${i + 1}: start_time must be a non-negative number`);
      }
      if (typeof interval.end_time !== 'number' || interval.end_time <= interval.start_time) {
        throw new Error(`Interval ${i + 1}: end_time must be greater than start_time`);
      }
      if (interval.type !== 'WORK' && interval.type !== 'RECOVERY') {
        throw new Error(`Interval ${i + 1}: type must be 'WORK' or 'RECOVERY'`);
      }
    }

    await this.intervals.updateActivityIntervals(activity_id, intervals, replace_existing_intervals);

    return {
      activity_id,
      intervals_set: intervals.length,
      intervals_icu_url: `https://intervals.icu/activities/${activity_id}`,
    };
  }
}
