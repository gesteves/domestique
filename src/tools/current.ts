import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateString, getToday } from '../utils/date-parser.js';
import type {
  RecoveryData,
  StrainData,
  PlannedWorkout,
  NormalizedWorkout,
} from '../types/index.js';
import type { GetStrainHistoryInput } from './types.js';

export class CurrentTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null,
    private trainerroad: TrainerRoadClient | null
  ) {}

  /**
   * Get today's recovery data from Whoop
   */
  async getTodaysRecovery(): Promise<RecoveryData | null> {
    if (!this.whoop) {
      return null;
    }

    try {
      return await this.whoop.getTodayRecovery();
    } catch (error) {
      console.error('Error fetching today\'s recovery:', error);
      throw error;
    }
  }

  /**
   * Get today's strain data from Whoop
   */
  async getTodaysStrain(): Promise<StrainData | null> {
    if (!this.whoop) {
      return null;
    }

    const today = getToday();

    try {
      const data = await this.whoop.getStrainData(today, today);
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('Error fetching today\'s strain:', error);
      throw error;
    }
  }

  /**
   * Get today's completed workouts from Intervals.icu
   */
  async getTodaysCompletedWorkouts(): Promise<NormalizedWorkout[]> {
    const today = getToday();

    try {
      return await this.intervals.getActivities(today, today);
    } catch (error) {
      console.error('Error fetching today\'s completed workouts:', error);
      throw error;
    }
  }

  /**
   * Get strain history from Whoop for a date range
   */
  async getStrainHistory(params: GetStrainHistoryInput): Promise<StrainData[]> {
    if (!this.whoop) {
      return [];
    }

    const startDate = parseDateString(params.start_date);
    const endDate = params.end_date ? parseDateString(params.end_date) : getToday();

    try {
      return await this.whoop.getStrainData(startDate, endDate);
    } catch (error) {
      console.error('Error fetching strain history:', error);
      throw error;
    }
  }

  /**
   * Get today's planned workouts from both TrainerRoad and Intervals.icu.
   * Returns a single merged array, preferring TrainerRoad for duplicates (has more detail).
   */
  async getTodaysPlannedWorkouts(): Promise<PlannedWorkout[]> {
    const today = getToday();

    // Fetch from both sources in parallel
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getTodayWorkouts().catch((e) => {
        console.error('Error fetching TrainerRoad workouts:', e);
        return [];
      }) ?? Promise.resolve([]),
      this.intervals.getPlannedEvents(today, today).catch((e) => {
        console.error('Error fetching Intervals.icu events:', e);
        return [];
      }),
    ]);

    // Merge workouts, preferring TrainerRoad for duplicates (has more detail)
    const merged = [...trainerroadWorkouts];

    // Add Intervals.icu workouts that don't seem to be duplicates
    for (const intervalsWorkout of intervalsWorkouts) {
      const isDuplicate = trainerroadWorkouts.some((tr) =>
        this.areWorkoutsSimilar(tr, intervalsWorkout)
      );
      if (!isDuplicate) {
        merged.push(intervalsWorkout);
      }
    }

    return merged;
  }

  /**
   * Check if two workouts are likely the same (for deduplication)
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
