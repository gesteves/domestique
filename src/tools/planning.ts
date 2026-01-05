import { addDays, format } from 'date-fns';
import { IntervalsClient } from '../clients/intervals.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateStringInTimezone } from '../utils/date-parser.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar } from '../utils/workout-utils.js';
import type {
  PlannedWorkout,
  ActivityType,
  Race,
  CreateRunWorkoutInput,
  CreateCyclingWorkoutInput,
  CreateWorkoutResponse,
  UpdateWorkoutInput,
  UpdateWorkoutResponse,
  SyncTRRunsResult,
  SetWorkoutIntervalsInput,
  SetWorkoutIntervalsResponse,
} from '../types/index.js';
import type { GetUpcomingWorkoutsInput } from './types.js';

/**
 * Response type for upcoming workouts.
 */
export interface UpcomingWorkoutsResponse {
  workouts: PlannedWorkout[];
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

    return {
      workouts: sortedWorkouts,
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
   * Update a Domestique-created workout in Intervals.icu.
   * Only updates workouts tagged with 'domestique'.
   */
  async updateWorkout(input: UpdateWorkoutInput): Promise<UpdateWorkoutResponse> {
    const { event_id, name, description, workout_doc, scheduled_for, type } = input;

    // First, verify the workout exists and has the domestique tag
    const existingEvent = await this.intervals.getEvent(event_id);

    if (!existingEvent.tags?.includes(DOMESTIQUE_TAG)) {
      throw new Error(
        `Cannot update this workout: it was not created by Domestique. ` +
        `Only workouts tagged with "${DOMESTIQUE_TAG}" can be updated via this tool.`
      );
    }

    // Build the update payload - only include fields that were provided
    const updatePayload: Record<string, unknown> = {};
    const updatedFields: string[] = [];

    if (name !== undefined) {
      updatePayload.name = name;
      updatedFields.push('name');
    }

    // Handle description + workout_doc combination
    if (description !== undefined || workout_doc !== undefined) {
      const newDescription = description ?? '';
      const newWorkoutDoc = workout_doc ?? '';
      updatePayload.description = newDescription
        ? `${newDescription}\n\n${newWorkoutDoc}`
        : newWorkoutDoc;
      if (description !== undefined) updatedFields.push('description');
      if (workout_doc !== undefined) updatedFields.push('workout_doc');
    }

    if (scheduled_for !== undefined) {
      const timezone = await this.intervals.getAthleteTimezone();

      // Check if input already has a time component
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduled_for)) {
        updatePayload.start_date_local = scheduled_for;
      } else {
        const dateOnly = parseDateStringInTimezone(scheduled_for, timezone, 'scheduled_for');
        updatePayload.start_date_local = `${dateOnly}T00:00:00`;
      }
      updatedFields.push('scheduled_for');
    }

    if (type !== undefined) {
      updatePayload.type = type;
      updatedFields.push('type');
    }

    // Check if there's anything to update (besides tags)
    if (updatedFields.length === 0) {
      throw new Error(
        'No fields provided to update. Specify at least one of: name, description, workout_doc, scheduled_for, type'
      );
    }

    // Always preserve the existing tags (including domestique)
    updatePayload.tags = existingEvent.tags;

    const response = await this.intervals.updateEvent(event_id, updatePayload);

    // Determine the scheduled date for the URL
    const scheduledDate = (updatePayload.start_date_local as string) ?? existingEvent.start_date_local;

    return {
      id: response.id,
      uid: response.uid,
      name: response.name,
      scheduled_for: response.start_date_local,
      intervals_icu_url: `https://intervals.icu/calendar/${scheduledDate.split('T')[0]}`,
      updated_fields: updatedFields,
    };
  }

  /**
   * Sync TrainerRoad running workouts to Intervals.icu.
   * Identifies TR runs that need syncing, updating, and orphaned Domestique workouts.
   */
  async syncTRRuns(params: {
    oldest?: string;
    newest?: string;
  }): Promise<SyncTRRunsResult> {
    const result: SyncTRRunsResult = {
      tr_runs_found: 0,
      orphans_deleted: 0,
      runs_to_sync: [],
      runs_to_update: [],
      deleted: [],
      updated: [],
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

    // 3. Build lookup map: external_id -> ICU workout
    const icuByExternalId = new Map(
      domestiqueWorkouts
        .filter((d) => d.external_id)
        .map((d) => [d.external_id!, d])
    );

    // 4. Categorize TR runs: new (need syncing) or changed (need updating)
    for (const trRun of trRuns) {
      const existingIcu = icuByExternalId.get(trRun.id);

      if (!existingIcu) {
        // No matching ICU workout - needs to be created
        result.runs_to_sync.push({
          tr_uid: trRun.id,
          tr_name: trRun.name,
          tr_description: trRun.description,
          scheduled_for: trRun.scheduled_for,
          expected_tss: trRun.expected_tss,
          expected_duration: trRun.expected_duration,
        });
      } else {
        // Matching ICU workout exists - check for changes
        const changes = this.detectWorkoutChanges(trRun, existingIcu);

        if (changes.length > 0) {
          result.runs_to_update.push({
            tr_uid: trRun.id,
            tr_name: trRun.name,
            tr_description: trRun.description,
            scheduled_for: trRun.scheduled_for,
            expected_tss: trRun.expected_tss,
            expected_duration: trRun.expected_duration,
            icu_event_id: String(existingIcu.id),
            icu_name: existingIcu.name,
            changes,
          });
        }
        // If no changes, workout is already synced and up-to-date
      }
    }

    // 5. Find orphaned Domestique workouts (external_id no longer in TR)
    const trIds = new Set(trRuns.map((tr) => tr.id));
    const orphans = domestiqueWorkouts.filter(
      (d) => d.external_id && !trIds.has(d.external_id)
    );

    // 6. Delete orphans
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

    return result;
  }

  /**
   * Detect what has changed between a TR workout and its synced ICU workout.
   * Returns array of changed field names.
   */
  private detectWorkoutChanges(
    trRun: PlannedWorkout,
    icuWorkout: { name: string; start_date_local: string; description?: string }
  ): string[] {
    const changes: string[] = [];

    // Name change
    if (trRun.name !== icuWorkout.name) {
      changes.push('name');
    }

    // Date change (compare date portion only)
    const trDate = trRun.scheduled_for.split('T')[0];
    const icuDate = icuWorkout.start_date_local.split('T')[0];
    if (trDate !== icuDate) {
      changes.push('date');
    }

    // Description change - check if TR description is still contained in ICU description
    // (ICU description may have workout_doc appended)
    if (trRun.description && icuWorkout.description) {
      const trDesc = trRun.description.trim();
      const icuDesc = icuWorkout.description.trim();
      // TR description should be contained in ICU description
      if (!icuDesc.includes(trDesc)) {
        changes.push('description');
      }
    } else if (trRun.description && !icuWorkout.description) {
      // TR has description, ICU doesn't
      changes.push('description');
    }

    return changes;
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
