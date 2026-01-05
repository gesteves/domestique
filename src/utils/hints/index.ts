/**
 * Generic hint system for tool responses.
 * Hints provide contextual, actionable suggestions based on tool response data.
 */

// Re-export core hint types and functions
export { type HintGenerator, generateHints } from '../hints.js';

// Export domain-specific hint generators
export * from './workout-hints.js';
export * from './recovery-hints.js';
export * from './fitness-hints.js';
