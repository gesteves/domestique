/**
 * Convert a plain-language description of a workout's structure into
 * Intervals.icu's workout-doc syntax via Claude.
 *
 * `create_workout` and `update_workout` accept a `structure` field — a free-form
 * description of warmup / intervals / recoveries / cooldown — and this util
 * turns that into syntax the Intervals.icu API will parse into structured
 * steps. Sport-specific system prompts (cycling, running) live in
 * `src/prompts/` and are loaded at module init.
 *
 * Throws when `ANTHROPIC_API_KEY` is missing — at the tool layer that surfaces
 * as a hard error with a clear message, not a silent fallback. Transport / parse
 * failures also throw and are surfaced to the caller.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getWorkoutModel } from './classifier-model.js';
import { loadPrompt } from './load-prompt.js';
import { logApiCall } from './logger.js';

const CYCLING_SYSTEM_PROMPT = loadPrompt('cycling-workout-structure.md');
const RUNNING_SYSTEM_PROMPT = loadPrompt('running-workout-structure.md');

const WorkoutDocSchema = z.object({
  workout_doc: z
    .string()
    .describe(
      'The complete Intervals.icu workout-doc syntax as a single plain string. No code fences, no preamble, no trailing explanation.'
    ),
});

export type WorkoutGeneratorSport = 'cycling' | 'running';

interface GenerateWorkoutDocInput {
  sport: WorkoutGeneratorSport;
  structure: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

function systemPromptFor(sport: WorkoutGeneratorSport): string {
  return sport === 'cycling' ? CYCLING_SYSTEM_PROMPT : RUNNING_SYSTEM_PROMPT;
}

/**
 * Generous timeout for the conversion call. The prompts are small and the
 * output is short, so anything past this is a degenerate stall.
 */
const ANTHROPIC_TIMEOUT_MS = 60_000;

/**
 * Convert a plain-language `structure` description into Intervals.icu
 * workout-doc syntax. Cycling and running only — swimming is stored verbatim
 * and shouldn't reach this function.
 *
 * @throws Error when `ANTHROPIC_API_KEY` is not set (caller decides how to
 *         surface). Transport and parse failures also throw.
 */
export async function generateWorkoutDoc(input: GenerateWorkoutDocInput): Promise<string> {
  const structure = input.structure.trim();
  if (!structure) {
    throw new Error('`structure` is empty — provide a plain-language workout description.');
  }

  const anthropic = getClient();
  if (!anthropic) {
    throw new Error(
      'Set `ANTHROPIC_API_KEY` to enable workout-structure conversion. ' +
        '`create_workout` and `update_workout` need it to turn the `structure` field into Intervals.icu syntax.'
    );
  }

  logApiCall('Anthropic', `workout-doc:${input.sport} (model=${getWorkoutModel()})`, 'messages.parse');
  const message = await anthropic.messages.parse(
    {
      model: getWorkoutModel(),
      max_tokens: 2048,
      system: systemPromptFor(input.sport),
      messages: [
        {
          role: 'user',
          content: structure,
        },
      ],
      output_config: {
        format: zodOutputFormat(WorkoutDocSchema),
      },
    },
    { timeout: ANTHROPIC_TIMEOUT_MS }
  );

  const workoutDoc = message.parsed_output?.workout_doc?.trim();
  if (!workoutDoc) {
    throw new Error('Claude returned an empty workout_doc for the given structure.');
  }
  return workoutDoc;
}

/**
 * Reset the cached client. Test-only.
 * @internal
 */
export function _resetWorkoutGeneratorClientForTesting(): void {
  client = null;
}
