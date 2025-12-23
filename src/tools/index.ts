import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { CurrentTools } from './current.js';
import { HistoricalTools } from './historical.js';
import { PlanningTools } from './planning.js';
import {
  combineFieldDescriptions,
  getFieldDescriptions,
} from '../utils/field-descriptions.js';

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

    // Connect Whoop client to Intervals.icu timezone for proper date filtering
    if (whoopClient) {
      whoopClient.setTimezoneGetter(() => intervalsClient.getAthleteTimezone());
    }

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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('recovery'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    server.tool(
      'get_todays_strain',
      "Fetch today's Whoop strain data including strain score, heart rate, and calories.",
      {},
      async () => {
        const result = await this.currentTools.getTodaysStrain();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('whoop'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    server.tool(
      'get_todays_completed_workouts',
      "Fetch today's completed workouts from Intervals.icu.",
      {},
      async () => {
        const result = await this.currentTools.getTodaysCompletedWorkouts();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('workout'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    server.tool(
      'get_strain_history',
      'Get Whoop strain scores and activities for a date range.',
      {
        start_date: z.string().describe('Start date - ISO format (YYYY-MM-DD) or natural language (e.g., "7 days ago")'),
        end_date: z.string().optional().describe('End date (defaults to today)'),
      },
      async (args) => {
        const result = await this.currentTools.getStrainHistory(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('whoop'),
            data: result,
          }, null, 2) }],
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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('planned'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    server.tool(
      'get_athlete_profile',
      "Get the athlete's profile including sport-specific settings for power zones, heart rate zones, pace zones, FTP, LTHR, and thresholds. Useful for understanding training zones and interpreting workout data.",
      {},
      async () => {
        const result = await this.currentTools.getAthleteProfile();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('athlete_profile'),
            data: result,
          }, null, 2) }],
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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: combineFieldDescriptions('workout', 'whoop'),
            data: result,
          }, null, 2) }],
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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('recovery'),
            data: result,
          }, null, 2) }],
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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('planned'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    server.tool(
      'get_planned_workout_details',
      'Get planned workouts for a specific date. Use natural language like "next wednesday" or ISO format. Optionally filter by sport (e.g., "What is my bike workout on Thursday?").',
      {
        date: z.string().describe('Date to find workout on - ISO format (YYYY-MM-DD) or natural language (e.g., "next wednesday", "tomorrow")'),
        sport: z.enum(['cycling', 'running', 'swimming']).optional().describe('Filter by sport type (cycling = bike, running = run, swimming = swim)'),
      },
      async (args) => {
        const result = await this.planningTools.getPlannedWorkoutDetails(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('planned'),
            data: result,
          }, null, 2) }],
        };
      }
    );

    // ============================================
    // Analysis Tools
    // ============================================

    server.tool(
      'get_training_load_trends',
      'Get training load trends including CTL (fitness), ATL (fatigue), TSB (form), ramp rate, and Acute:Chronic Workload Ratio (ACWR) for injury risk assessment. Returns daily data sorted oldest to newest. ACWR between 0.8-1.3 is optimal; above 1.5 indicates high injury risk.',
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
          content: [{ type: 'text' as const, text: JSON.stringify({
            _field_descriptions: getFieldDescriptions('fitness'),
            data: result,
          }, null, 2) }],
        };
      }
    );
  }
}
