/**
 * Token counting utility using the Anthropic API.
 * Only active in development mode.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages/count_tokens';

interface TokenCountResponse {
  input_tokens: number;
}

interface TokenCountError {
  error: {
    type: string;
    message: string;
  };
}

/**
 * Counts the number of tokens in a string using the Anthropic API.
 * Returns null if token counting is unavailable (missing API key, production mode, or API error).
 *
 * @param content - The content to count tokens for
 * @returns The number of tokens, or null if unavailable
 */
export async function countTokens(content: string): Promise<number | null> {
  // Only run in development mode
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        messages: [
          {
            role: 'user',
            content: content,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as TokenCountError;
      console.error('[token-counter] API error:', error.error?.message ?? response.statusText);
      return null;
    }

    const data = (await response.json()) as TokenCountResponse;
    return data.input_tokens;
  } catch (error) {
    console.error('[token-counter] Failed to count tokens:', error);
    return null;
  }
}
