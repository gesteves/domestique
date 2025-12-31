import { addDays, format } from 'date-fns';
import { IntervalsClient } from '../clients/intervals.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateStringInTimezone } from '../utils/date-parser.js';
import type {
  PlannedWorkout,
  ActivityType,
  Race,
  CreateRunWorkoutInput,
  CreateWorkoutResponse,
  SyncTRRunsResult,
} from '../types/index.js';
import type { GetUpcomingWorkoutsInput } from './types.js';

/** Tag used to identify Domestique-created workouts */
const DOMESTIQUE_TAG = 'domestique';

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
    const hint = this.generateSyncHint(trainerroadWorkouts, intervalsWorkouts);

    return {
      workouts: sortedWorkouts,
      ...(hint && { _instructions: hint }),
    };
  }

  /**
   * Generate a hint for TR runs that can be synced to Intervals.icu.
   */
  private generateSyncHint(
    trWorkouts: PlannedWorkout[],
    icuWorkouts: PlannedWorkout[]
  ): string | undefined {
    // Find TR runs without matching ICU workouts
    const trRuns = trWorkouts.filter((w) => w.sport === 'Running');
    if (trRuns.length === 0) return undefined;

    // Check which TR runs don't have a matching ICU workout with the domestique tag
    const unsyncedRuns = trRuns.filter((trRun) => {
      // Check if there's a matching ICU workout with the same external_id
      const hasMatchingIcu = icuWorkouts.some(
        (icu) =>
          icu.tags?.includes(DOMESTIQUE_TAG) &&
          (icu.external_id === trRun.id || this.areWorkoutsSimilar(trRun, icu))
      );
      return !hasMatchingIcu;
    });

    if (unsyncedRuns.length === 0) return undefined;

    return (
      `Found ${unsyncedRuns.length} TrainerRoad running workout(s) that could be synced to Intervals.icu ` +
      `for structured execution on Zwift/Garmin. You can offer to sync these using the create_run_workout tool. ` +
      `First fetch the user's running pace zones via get_sports_settings, then read the intervals-run-workout-syntax resource for syntax documentation.`
    );
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
        this.areWorkoutsSimilar(tr, intervalsWorkout)
      );
      if (!isDuplicate) {
        merged.push(intervalsWorkout);
      }
    }

    return merged;
  }

  /**
   * Check if two workouts are likely the same
   */
  private areWorkoutsSimilar(a: PlannedWorkout, b: PlannedWorkout): boolean {
    // Same day check
    const dateA = a.scheduled_for.split('T')[0];
    const dateB = b.scheduled_for.split('T')[0];
    if (dateA !== dateB) return false;

    // External ID match (highest confidence) - check if TR id matches ICU external_id
    if (a.external_id && b.external_id && a.external_id === b.external_id) return true;
    if (a.id && b.external_id === a.id) return true;
    if (b.id && a.external_id === b.id) return true;

    // Similar name check (fuzzy)
    const nameA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nameB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameA.includes(nameB) || nameB.includes(nameA)) return true;

    // Similar TSS check
    if (a.expected_tss && b.expected_tss) {
      const tssDiff = Math.abs(a.expected_tss - b.expected_tss);
      if (tssDiff < 5) return true;
    }

    return false;
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
}
