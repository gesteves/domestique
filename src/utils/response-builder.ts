/**
 * Response builder for MCP tools.
 * Constructs responses with contextual guidance for the LLM.
 */

import { enhanceWithHeatZonesSummary } from './field-descriptions.js';
import { countTokens } from './token-counter.js';

/**
 * Recursively removes null and undefined values from an object or array.
 * This reduces token usage by not sending empty fields to the LLM.
 *
 * @param obj - The object or array to clean
 * @returns A new object/array with null/undefined values removed
 */
export function removeNullFields<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .map((item) => removeNullFields(item))
      .filter((item) => item !== null && item !== undefined) as T;
  }

  // Handle objects
  if (typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        cleaned[key] = removeNullFields(value);
      }
    }
    return cleaned as T;
  }

  // Return primitives as-is
  return obj;
}

/**
 * Gets all field names that exist in the data (recursively).
 * Used to filter field descriptions to only include fields present in the data.
 *
 * @param obj - The data object to scan
 * @returns Set of field names present in the data
 */
function getFieldsInData(obj: unknown): Set<string> {
  const fields = new Set<string>();

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return fields;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const itemFields = getFieldsInData(item);
      itemFields.forEach((f) => fields.add(f));
    }
    return fields;
  }

  for (const [key, value] of Object.entries(obj)) {
    fields.add(key);
    const nestedFields = getFieldsInData(value);
    nestedFields.forEach((f) => fields.add(f));
  }

  return fields;
}

/**
 * Filters field descriptions to only include fields present in the data.
 * This reduces token usage by not sending descriptions for null fields.
 *
 * @param descriptions - All available field descriptions
 * @param data - The actual data
 * @returns Filtered field descriptions
 */
export function filterFieldDescriptions(
  descriptions: Record<string, string>,
  data: unknown
): Record<string, string> {
  const fieldsInData = getFieldsInData(data);
  const filtered: Record<string, string> = {};

  for (const [key, description] of Object.entries(descriptions)) {
    if (fieldsInData.has(key)) {
      filtered[key] = description;
    }
  }

  return filtered;
}

export interface ResponseBuilderOptions {
  /** The main data payload */
  data: unknown;
  /** Field descriptions to help LLM understand the data */
  fieldDescriptions: Record<string, string>;
  /** Optional metadata for ChatGPT widgets (not visible to model) */
  widgetMeta?: Record<string, unknown>;
}

export interface DebugInfo {
  token_count: number;
}

export interface StructuredToolResponse {
  response: unknown;
  field_descriptions: Record<string, string>;
  _debug?: DebugInfo;
  [key: string]: unknown;
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: StructuredToolResponse;
  [key: string]: unknown;
}

/**
 * Builds a tool response with structuredContent for MCP.
 *
 * Returns:
 * - content: Short narration text for the model
 * - structuredContent: Parsed JSON data for modern MCP clients
 * - _meta: Optional widget-only data (not visible to model, for ChatGPT Apps)
 *
 * In development mode, adds a _debug object with token count to structuredContent.
 */
export async function buildToolResponse(options: ResponseBuilderOptions): Promise<ToolResponse> {
  const { data, widgetMeta } = options;

  // Remove null/undefined fields to reduce token usage
  const cleanedData = removeNullFields(data);

  // Filter field descriptions to only include fields present in the data
  const filteredDescriptions = filterFieldDescriptions(options.fieldDescriptions, cleanedData);

  // Enhance field descriptions with heat zones summary if heat data is present
  const fieldDescriptions = enhanceWithHeatZonesSummary(filteredDescriptions, cleanedData);

  const structuredContent: StructuredToolResponse = {
    response: cleanedData,
    field_descriptions: fieldDescriptions,
  };

  // In development mode, add token count to _debug
  const tokenCount = await countTokens(JSON.stringify(structuredContent, null, 2));
  if (tokenCount !== null) {
    structuredContent._debug = { token_count: tokenCount };
  }

  const response: ToolResponse = {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };

  // Add _meta if provided (for ChatGPT widgets - not visible to model)
  if (widgetMeta) {
    response._meta = widgetMeta;
  }

  return response;
}

export interface EmptyResponse {
  response: { message: string };
  field_descriptions: Record<string, string>;
  [key: string]: unknown;
}

export interface EmptyToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: EmptyResponse;
  [key: string]: unknown;
}

/**
 * Builds an empty result response with structuredContent.
 */
export function buildEmptyResponse(resourceType: string, narration?: string): EmptyToolResponse {
  const structuredContent: EmptyResponse = {
    response: { message: `No ${resourceType} found.` },
    field_descriptions: {},
  };

  return {
    content: [{ type: 'text' as const, text: narration || `No ${resourceType} found.` }],
    structuredContent,
  };
}
