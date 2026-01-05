/**
 * Generic hint system for tool responses.
 * Hints provide contextual, actionable suggestions based on tool response data.
 */

/**
 * A hint generator function that analyzes response data and returns hint(s).
 * Can return a single hint string, an array of hints, or undefined if no hint is applicable.
 */
export type HintGenerator<T> = (data: T) => string | string[] | undefined;

/**
 * Runs multiple hint generators against the data and collects non-null results.
 * Returns undefined if no hints were generated.
 *
 * @param data - The tool response data to analyze
 * @param generators - Array of hint generator functions
 * @returns Array of hint strings, or undefined if no hints
 */
export function generateHints<T>(
  data: T,
  generators: HintGenerator<T>[]
): string[] | undefined {
  const hints: string[] = [];

  for (const generator of generators) {
    const hint = generator(data);
    if (hint) {
      if (Array.isArray(hint)) {
        hints.push(...hint);
      } else {
        hints.push(hint);
      }
    }
  }

  return hints.length > 0 ? hints : undefined;
}
