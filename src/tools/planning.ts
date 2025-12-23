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
   * Get planned workouts for a specific date, optionally filtered by sport.
   * Returns merged workouts from both TrainerRoad and Intervals.icu.
   */
  async getPlannedWorkoutDetails(
    params: GetPlannedWorkoutDetailsInput
  ): Promise<PlannedWorkout[]> {
    const { date, sport } = params;
    const dateStr = parseDateString(date);

    // Fetch from both sources for the specified date
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getPlannedWorkouts(dateStr, dateStr).catch((e) => {
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
      const disciplineMap: Record<string, string> = {
        cycling: 'Bike',
        running: 'Run',
        swimming: 'Swim',
      };
      const discipline = disciplineMap[sport];
      workouts = workouts.filter((w) => w.discipline === discipline);
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
