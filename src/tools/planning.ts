import { addDays, format } from 'date-fns';
import { IntervalsClient } from '../clients/intervals.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateString, getToday } from '../utils/date-parser.js';
import type { PlannedWorkout } from '../types/index.js';
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
    const { days, sport } = params;
    const today = new Date();
    const endDate = addDays(today, days);

    const startDateStr = format(today, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');

    // Fetch from both sources in parallel
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getPlannedWorkouts(startDateStr, endDateStr).catch((e) => {
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
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }

  /**
   * Get detailed information about a specific planned workout
   */
  async getPlannedWorkoutDetails(
    params: GetPlannedWorkoutDetailsInput
  ): Promise<PlannedWorkout | null> {
    const { workout_id, date, source } = params;

    if (workout_id) {
      // Find by ID
      if (source === 'trainerroad' && this.trainerroad) {
        const workouts = await this.trainerroad.getUpcomingWorkouts(30);
        return workouts.find((w) => w.id === workout_id) ?? null;
      } else if (source === 'intervals.icu') {
        const today = format(new Date(), 'yyyy-MM-dd');
        const futureDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
        const workouts = await this.intervals.getPlannedEvents(today, futureDate);
        return workouts.find((w) => w.id === workout_id) ?? null;
      }

      // Search both if source not specified
      const [trWorkouts, intWorkouts] = await Promise.all([
        this.trainerroad?.getUpcomingWorkouts(30) ?? Promise.resolve([]),
        this.intervals
          .getPlannedEvents(
            format(new Date(), 'yyyy-MM-dd'),
            format(addDays(new Date(), 30), 'yyyy-MM-dd')
          )
          .catch(() => []),
      ]);

      return (
        trWorkouts.find((w) => w.id === workout_id) ??
        intWorkouts.find((w) => w.id === workout_id) ??
        null
      );
    }

    if (date) {
      // Find by date
      const dateStr = parseDateString(date);

      if (source === 'trainerroad' && this.trainerroad) {
        const workouts = await this.trainerroad.getPlannedWorkouts(dateStr, dateStr);
        return workouts[0] ?? null;
      } else if (source === 'intervals.icu') {
        const workouts = await this.intervals.getPlannedEvents(dateStr, dateStr);
        return workouts[0] ?? null;
      }

      // Get from both and return first match
      const [trWorkouts, intWorkouts] = await Promise.all([
        this.trainerroad?.getPlannedWorkouts(dateStr, dateStr) ?? Promise.resolve([]),
        this.intervals.getPlannedEvents(dateStr, dateStr).catch(() => []),
      ]);

      // Prefer TrainerRoad (more detailed)
      return trWorkouts[0] ?? intWorkouts[0] ?? null;
    }

    return null;
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
    const dateA = a.date.split('T')[0];
    const dateB = b.date.split('T')[0];
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
}
