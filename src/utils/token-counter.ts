/**
 * Token counting utility using the Anthropic SDK.
 * Only active in development mode.
 */

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/**
 * Counts the number of tokens in a string using the Anthropic API.
 * Returns null if token counting is unavailable (missing API key, production mode, or API error).
 *
 * @param content - The content to count tokens for
 * @returns The number of tokens, or null if unavailable
 */
export async function countTokens(content: string): Promise<number | null> {
  if (process.env.NODE_ENV !== 'development') return null;

  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const { input_tokens } = await anthropic.messages.countTokens({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content }],
    });
    return input_tokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[token-counter] Failed to count tokens:', message);
    return null;
  }
}

/**
 * Reset the cached client. Test-only.
 * @internal
 */
export function _resetTokenCounterClientForTesting(): void {
  client = null;
}
