/**
 * Response builder for MCP tools.
 *
 * Per the 2025-11-25 MCP spec, tools that declare an `outputSchema` MUST return
 * `structuredContent` that conforms to that schema. We do that by making the
 * handler's return value BE structuredContent — no envelope, no wrapper.
 *
 * - `structuredContent` is the typed data payload (validates against outputSchema).
 * - `content` carries a serialized JSON copy for backwards compatibility, plus
 *   any actionable hints the tool wants to surface to the model as narration.
 * - `_meta` carries out-of-band metadata not meant for the model: dev-mode
 *   token counts, ChatGPT widget data, etc. Clients are not required to forward
 *   `_meta` to the model.
 */

import { countTokens } from './token-counter.js';

/**
 * Recursively removes null and undefined values from an object or array.
 * This reduces token usage and lets schemas mark fields optional rather than
 * nullable.
 */
export function removeNullFields<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj
      .map((item) => removeNullFields(item))
      .filter((item) => item !== null && item !== undefined) as T;
  }

  if (typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        cleaned[key] = removeNullFields(value);
      }
    }
    return cleaned as T;
  }

  return obj;
}

export interface ResponseBuilderOptions {
  /** The data payload that becomes structuredContent (must be a JSON object). */
  data: Record<string, unknown>;
  /** Optional metadata for ChatGPT widgets. Surfaced via _meta, not visible to the model. */
  widgetMeta?: Record<string, unknown>;
  /** Optional hints providing actionable next steps. Surfaced as narration in content. */
  hints?: string[];
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/**
 * Builds a tool response with structured content per the 2025-11-25 MCP spec.
 *
 * The handler's data becomes structuredContent directly. Hints reach the model
 * via the content text block (narration); debug info and widget data live in
 * _meta where clients can choose whether to forward them.
 */
export async function buildToolResponse(options: ResponseBuilderOptions): Promise<ToolResponse> {
  const { data, widgetMeta, hints } = options;

  const cleanedData = removeNullFields(data);
  const jsonText = JSON.stringify(cleanedData, null, 2);

  // Compose narration: hints first (so the model sees them prominently), then
  // the serialized JSON for backwards compatibility with clients that read
  // content rather than structuredContent.
  const narrationParts: string[] = [];
  if (hints && hints.length > 0) {
    narrationParts.push(hints.map((h) => `- ${h}`).join('\n'));
  }
  narrationParts.push(jsonText);
  const narration = narrationParts.join('\n\n');

  const response: ToolResponse = {
    content: [{ type: 'text', text: narration }],
    structuredContent: cleanedData,
  };

  // Build _meta from optional sources. Skip the field entirely if empty.
  const meta: Record<string, unknown> = {};
  if (widgetMeta) {
    Object.assign(meta, widgetMeta);
  }
  const tokenCount = await countTokens(jsonText);
  if (tokenCount !== null) {
    meta.token_count = tokenCount;
  }
  if (Object.keys(meta).length > 0) {
    response._meta = meta;
  }

  return response;
}

/**
 * Builds an empty-result response. Used when the tool has nothing to return
 * (e.g., no workouts in the queried range).
 */
export function buildEmptyResponse(resourceType: string, narration?: string): ToolResponse {
  const message = `No ${resourceType} found.`;
  return {
    content: [{ type: 'text', text: narration || message }],
    structuredContent: { message },
  };
}
