import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { CurrentTools } from './current.js';
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';

export interface ToolsConfig {
  intervals: { apiKey: string; athleteId: string };
  whoop?: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  } | null;
  trainerroad?: { calendarUrl: string } | null;
}

export class ToolRegistry {
  private currentTools: CurrentTools;
  private historicalTools: HistoricalTools;
  private planningTools: PlanningTools;

  constructor(config: ToolsConfig) {
    const intervalsClient = new IntervalsClient(config.intervals);
    const whoopClient = config.whoop ? new WhoopClient(config.whoop) : null;
    const trainerroadClient = config.trainerroad
      ? new TrainerRoadClient(config.trainerroad)
      : null;

    this.currentTools = new CurrentTools(
      intervalsClient,
      whoopClient,
      trainerroadClient
    );
    this.historicalTools = new HistoricalTools(intervalsClient, whoopClient);
    this.planningTools = new PlanningTools(intervalsClient, trainerroadClient);
  }

  /**
   * Register all tools with the MCP server
   */
  registerTools(server: McpServer): void {
    // Current/Recent Data Tools
    server.tool(
      'get_todays_recovery',
      "Fetch today's Whoop recovery data including recovery score, HRV, sleep performance, and resting heart rate.",
      {},
      async () => {
        const result = await this.currentTools.getTodaysRecovery();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_recent_workouts',
      'Get completed workouts from Intervals.icu with matched Whoop strain data. Returns expanded metrics including speed, cadence, efficiency, power data, and per-activity fitness snapshot. Whoop data (strain score, calories) is included in a nested "whoop" object when a matching activity is found.',
      {
        days: z.number().optional().default(7).describe('Number of days to look back (default: 7, max: 90)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      async (args) => {
        const result = await this.currentTools.getRecentWorkouts(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_recent_strain',
      'Get Whoop strain scores and activities for the specified number of days.',
      {
        days: z.number().optional().default(7).describe('Number of days to look back (default: 7, max: 90)'),
      },
      async (args) => {
        const result = await this.currentTools.getRecentStrain(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_todays_planned_workouts',
      "Get all workouts scheduled for today from both TrainerRoad and Intervals.icu calendars.",
      {},
      async () => {
        const result = await this.currentTools.getTodaysPlannedWorkouts();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    // Historical/Trends Tools
    server.tool(
      'get_workout_history',
      'Query historical workouts with flexible date ranges. Supports ISO dates or natural language.',
      {
        start_date: z.string().describe('Start date - ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      async (args) => {
        const result = await this.historicalTools.getWorkoutHistory(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_recovery_trends',
      'Analyze HRV, sleep, and recovery patterns over time.',
      {
        start_date: z.string().describe('Start date - ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      async (args) => {
        const result = await this.historicalTools.getRecoveryTrends(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_fitness_progression',
      'Get CTL/ATL/TSB (fitness/fatigue/form) trends from Intervals.icu.',
      {
        start_date: z.string().describe('Start date - ISO format (YYYY-MM-DD) or natural language (e.g., "30 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      async (args) => {
        const result = await this.historicalTools.getFitnessProgression(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    // Planning Tools
    server.tool(
      'get_upcoming_workouts',
      'Get planned workouts for a future date range from both TrainerRoad and Intervals.icu calendars.',
      {
        days: z.number().optional().default(7).describe('Number of days ahead to look (default: 7, max: 30)'),
        sport: z.enum(['cycling', 'running', 'swimming', 'skiing', 'hiking', 'rowing', 'strength']).optional().describe('Filter by sport type'),
      },
      async (args) => {
        const result = await this.planningTools.getUpcomingWorkouts(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_planned_workout_details',
      'Get detailed information about a specific planned workout.',
      {
        workout_id: z.string().optional().describe('Workout ID to fetch details for'),
        date: z.string().optional().describe('Date to find workout on (alternative to workout_id)'),
        source: z.enum(['intervals.icu', 'trainerroad']).optional().describe('Which calendar source to use'),
      },
      async (args) => {
        const result = await this.planningTools.getPlannedWorkoutDetails(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    // ============================================
    // Athlete Profile & Analysis Tools
    // ============================================

    server.tool(
      'get_athlete_profile',
      'Get athlete profile from Intervals.icu including power zones, heart rate zones, pace zones, and current threshold values (FTP, LTHR, max HR, W\', Pmax) for each configured sport.',
      {
        sport: z
          .enum(['cycling', 'running', 'swimming'])
          .optional()
          .describe('Filter to specific sport (optional, returns all sports if not specified)'),
      },
      async (args) => {
        const result = await this.currentTools.getAthleteProfile();

        // Filter to specific sport if requested
        if (args.sport) {
          const sportMap: Record<string, string[]> = {
            cycling: ['Ride', 'Cycling', 'VirtualRide'],
            running: ['Run', 'Running', 'VirtualRun'],
            swimming: ['Swim', 'Swimming'],
          };
          const matchTypes = sportMap[args.sport] ?? [];
          result.sports = result.sports.filter((s) =>
            matchTypes.some((t) =>
              s.sport_type.toLowerCase().includes(t.toLowerCase())
            )
          );
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_power_curve',
      'Get power curve showing best power outputs at various durations (5s, 1min, 5min, 20min, 60min, etc.). Essential for identifying athlete strengths, tracking FTP progression, and setting appropriate workout intensities.',
      {
        sport: z
          .enum(['cycling'])
          .optional()
          .default('cycling')
          .describe('Sport type (currently only cycling supported)'),
        period: z
          .enum(['42d', '90d', '1y', 'all'])
          .optional()
          .default('90d')
          .describe('Time period for curve data (default: 90 days)'),
      },
      async (args) => {
        const sportType = args.sport === 'cycling' ? 'Ride' : 'Ride';
        const result = await this.historicalTools.getPowerCurve(sportType, args.period);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_pace_curve',
      'Get pace curve showing best running paces at various durations. Useful for setting appropriate run paces for workouts, tracking running fitness progression, and identifying race potential at various distances.',
      {
        period: z
          .enum(['42d', '90d', '1y', 'all'])
          .optional()
          .default('90d')
          .describe('Time period for curve data (default: 90 days)'),
        gradient_adjusted: z
          .boolean()
          .optional()
          .default(false)
          .describe('Use gradient-adjusted pace (GAP) to normalize for hills'),
      },
      async (args) => {
        const result = await this.historicalTools.getPaceCurve(
          args.period,
          args.gradient_adjusted
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    server.tool(
      'get_training_load_trends',
      'Get training load trends including CTL (fitness), ATL (fatigue), TSB (form), ramp rate, and Acute:Chronic Workload Ratio (ACWR) for injury risk assessment. ACWR between 0.8-1.3 is optimal; above 1.5 indicates high injury risk.',
      {
        days: z
          .number()
          .optional()
          .default(42)
          .describe('Number of days of history to analyze (default: 42, max: 365)'),
      },
      async (args) => {
        const result = await this.historicalTools.getTrainingLoadTrends(args.days);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  }
}
