/**
 * Extract the priority (A, B, or C) of an upcoming triathlon from the user-
 * authored description of its umbrella event in the TrainerRoad calendar.
 *
 * Returns null when:
 *   - the API key is unset,
 *   - both name and description are empty,
 *   - the model says the priority isn't stated (`'none'` sentinel),
 *   - or the API/parse call fails.
 *
 * Callers should emit the Race with `priority: undefined` (i.e. omit the field)
 * when this returns null.
 *
 * Results are cached in Redis by content hash (name + '\n' + description). The
 * description IS part of the key, so editing the description in TR — e.g.
 * later adding "B race" to a previously-blank entry — invalidates the cache
 * and triggers a fresh classification on the next fetch. The user is not
 * stuck with a stale "no priority" verdict for the 30-day TTL.
 */

import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { RacePriority } from '../types/index.js';
import { getClassifierModel } from './classifier-model.js';
import { loadPrompt } from './load-prompt.js';
import { redisGetJson, redisSetJson } from './redis.js';

const CACHE_KEY_PREFIX = 'domestique:race-priority:v1:';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const PrioritySchema = z.object({
  priority: z.enum(['A', 'B', 'C', 'none']),
});

const SYSTEM_PROMPT = loadPrompt('race-priority.md');

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

function cacheKey(name: string, description: string): string {
  // Description is part of the key so user edits invalidate the cache. Don't
  // change this without thinking about the stale-verdict case described above.
  const hash = createHash('sha256').update(`${name}\n${description}`).digest('hex');
  return `${CACHE_KEY_PREFIX}${hash}`;
}

interface ClassifyInput {
  name?: string;
  description?: string;
}

/**
 * Classify a triathlon's race priority. Returns 'A' | 'B' | 'C' when stated,
 * or null if not stated, unavailable, or on error.
 */
export async function classifyRacePriority(
  input: ClassifyInput
): Promise<RacePriority | null> {
  const name = input.name?.trim() ?? '';
  const description = input.description?.trim() ?? '';

  if (!name && !description) return null;

  const anthropic = getClient();
  if (!anthropic) return null;

  const key = cacheKey(name, description);

  const cached = await redisGetJson<{ priority: 'A' | 'B' | 'C' | 'none' }>(key);
  if (cached?.priority) {
    return cached.priority === 'none' ? null : cached.priority;
  }

  let raw: 'A' | 'B' | 'C' | 'none' | null = null;
  try {
    const message = await anthropic.messages.parse({
      model: getClassifierModel(),
      max_tokens: 64,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Title: ${name || '(none)'}\n\nDescription: ${description || '(none)'}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(PrioritySchema),
      },
    });
    raw = message.parsed_output?.priority ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[race-priority-classifier] Failed to classify priority:', msg);
    return null;
  }

  if (raw) {
    // Cache both stated priorities and the 'none' verdict — re-asking for the
    // same content yields the same answer. The cache key already includes the
    // description, so an edit invalidates this entry naturally.
    await redisSetJson(key, { priority: raw }, CACHE_TTL_SECONDS);
  }

  return raw === 'none' || raw === null ? null : raw;
}

/**
 * Reset the cached client. Test-only.
 * @internal
 */
export function _resetClassifierClientForTesting(): void {
  client = null;
}

/** @internal Exposed for cache-key assertions in tests. */
export const _CACHE_KEY_PREFIX_FOR_TESTING = CACHE_KEY_PREFIX;
