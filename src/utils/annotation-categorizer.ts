/**
 * Categorize a TrainerRoad calendar annotation into one of the four
 * Intervals.icu annotation categories using Claude Haiku.
 *
 * Optional: returns null if the Anthropic API key is missing, the input has
 * no text to classify, or the API/parse call fails. Callers should default
 * to 'Note' on null.
 *
 * Results are cached in Redis (when configured) by content hash with a long
 * TTL, since the same annotation text always classifies the same way.
 */

import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AnnotationCategory } from '../types/index.js';
import { redisGetJson, redisSetJson } from './redis.js';

const MODEL = 'claude-haiku-4-5';
const CACHE_KEY_PREFIX = 'domestique:annotation-category:v1:';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const CategorySchema = z.object({
  category: z.enum(['Sick', 'Injured', 'Holiday', 'Note']),
});

const SYSTEM_PROMPT =
  'You classify TrainerRoad calendar annotations into one of four Intervals.icu categories: ' +
  'Sick (illness, cold, flu, fever, infection, etc.), ' +
  'Injured (physical injury, soreness from injury, recovering from injury, surgery, etc.), ' +
  'Holiday (vacation, travel, time off, family trip, etc.), ' +
  'or Note (anything else: training notes, races, work events, conferences, life events, reminders). ' +
  'When in doubt, choose Note.';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

function cacheKey(name: string, description: string): string {
  const hash = createHash('sha256').update(`${name}\n${description}`).digest('hex');
  return `${CACHE_KEY_PREFIX}${hash}`;
}

interface CategorizeInput {
  name?: string;
  description?: string;
}

/**
 * Categorize a TrainerRoad annotation. Returns the category, or null if
 * categorization is unavailable or fails.
 */
export async function categorizeAnnotation(
  input: CategorizeInput
): Promise<AnnotationCategory | null> {
  const name = input.name?.trim() ?? '';
  const description = input.description?.trim() ?? '';

  if (!name && !description) return null;

  const anthropic = getClient();
  if (!anthropic) return null;

  const key = cacheKey(name, description);

  const cached = await redisGetJson<{ category: AnnotationCategory }>(key);
  if (cached?.category) return cached.category;

  let category: AnnotationCategory | null = null;
  try {
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Title: ${name || '(none)'}\n\nDescription: ${description || '(none)'}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(CategorySchema),
      },
    });
    category = message.parsed_output?.category ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[annotation-categorizer] Failed to classify annotation:', msg);
    return null;
  }

  if (category) {
    await redisSetJson(key, { category }, CACHE_TTL_SECONDS);
  }
  return category;
}

/**
 * Reset the cached client. Test-only.
 * @internal
 */
export function _resetCategorizerClientForTesting(): void {
  client = null;
}
