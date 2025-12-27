/**
 * Response builder for MCP tools.
 * Constructs responses with contextual guidance for the LLM.
 */

import { enhanceWithHeatZonesSummary } from './field-descriptions.js';

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
  /** Suggested follow-up tools or actions */
  nextActions?: string[];
  /** Warnings or notes about the data (e.g., "Whoop data unavailable") */
  warnings?: string[];
}

/**
 * Builds a tool response with contextual guidance.
 *
 * Response format:
 * - Warnings: Any issues or limitations
 * - Data: The actual JSON data
 * - Next Actions: Suggested follow-up tools
 * - Field Descriptions: Help for interpreting fields
 */
export function buildToolResponse(options: ResponseBuilderOptions): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const { data, nextActions, warnings } = options;

  // Remove null/undefined fields to reduce token usage
  const cleanedData = removeNullFields(data);

  // Filter field descriptions to only include fields present in the data
  const filteredDescriptions = filterFieldDescriptions(options.fieldDescriptions, cleanedData);

  // Enhance field descriptions with heat zones summary if heat data is present
  const fieldDescriptions = enhanceWithHeatZonesSummary(filteredDescriptions, cleanedData);

  const parts: string[] = [];

  // Add warnings if any
  if (warnings && warnings.length > 0) {
    parts.push('NOTES:');
    for (const warning of warnings) {
      parts.push(`  - ${warning}`);
    }
    parts.push('');
  }

  // Add the actual data
  parts.push(JSON.stringify(cleanedData, null, 2));

  // Add next action suggestions
  if (nextActions && nextActions.length > 0) {
    parts.push('');
    parts.push('SUGGESTED NEXT ACTIONS:');
    for (const action of nextActions) {
      parts.push(`  - ${action}`);
    }
  }

  // Add field descriptions at the end
  parts.push('');
  parts.push('FIELD DESCRIPTIONS:');
  parts.push(JSON.stringify(fieldDescriptions, null, 2));

  return {
    content: [{ type: 'text' as const, text: parts.join('\n') }],
  };
}

/**
 * Builds an empty result response with guidance.
 */
export function buildEmptyResponse(
  resourceType: string,
  suggestion?: string
): { content: Array<{ type: 'text'; text: string }> } {
  const parts = [`No ${resourceType} found.`];

  if (suggestion) {
    parts.push('');
    parts.push(`Suggestion: ${suggestion}`);
  }

  return {
    content: [{ type: 'text' as const, text: parts.join('\n') }],
  };
}
