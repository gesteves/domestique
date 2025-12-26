/**
 * Response builder for MCP tools.
 * Constructs responses with contextual guidance for the LLM.
 */

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
  const { data, fieldDescriptions, nextActions, warnings } = options;

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
  parts.push(JSON.stringify(data, null, 2));

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
