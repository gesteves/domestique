import { addDays, format } from 'date-fns';
import { IntervalsClient } from '../clients/intervals.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateStringInTimezone } from '../utils/date-parser.js';
import type { PlannedWorkout, ActivityType, Race } from '../types/index.js';
import type {
  GetUpcomingWorkoutsInput,
  GetPlannedWorkoutDetailsInput,
} from './types.js';

export class PlanningTools {
  constructor(
    private intervals: IntervalsClient,
    private trainerroad: TrainerRoadClient | null
  ) {}

  /**
   * Get upcoming planned workouts from both calendars
   */
  async getUpcomingWorkouts(params: GetUpcomingWorkoutsInput): Promise<PlannedWorkout[]> {
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
    const merged = this.mergeWorkouts(trainerroadWorkouts, intervalsWorkouts);
    return merged.sort(
      (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
    );
  }

  /**
   * Get planned workouts for a specific date, optionally filtered by sport.
   * Returns merged workouts from both TrainerRoad and Intervals.icu.
   */
  async getPlannedWorkoutDetails(
    params: GetPlannedWorkoutDetailsInput
  ): Promise<PlannedWorkout[]> {
    const { date, sport } = params;

    // Use athlete's timezone for date parsing
    const timezone = await this.intervals.getAthleteTimezone();
    const dateStr = parseDateStringInTimezone(date, timezone, 'date');

    // Fetch from both sources for the specified date
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getPlannedWorkouts(dateStr, dateStr, timezone).catch((e) => {
        console.error('Error fetching TrainerRoad workouts:', e);
        return [];
      }) ?? Promise.resolve([]),
      this.intervals.getPlannedEvents(dateStr, dateStr).catch((e) => {
        console.error('Error fetching Intervals.icu events:', e);
        return [];
      }),
    ]);

    // Merge and deduplicate
    let workouts = this.mergeWorkouts(trainerroadWorkouts, intervalsWorkouts);

    // Filter by sport if specified
    if (sport) {
      const sportMap: Record<string, ActivityType> = {
        cycling: 'Cycling',
        running: 'Running',
        swimming: 'Swimming',
      };
      const activityType = sportMap[sport];
      workouts = workouts.filter((w) => w.sport === activityType);
    }

    return workouts;
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
}
