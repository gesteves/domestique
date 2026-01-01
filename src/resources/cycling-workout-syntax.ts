import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * MCP Resource content for Intervals.icu cycling workout syntax.
 * Content is loaded from the markdown file for easier editing.
 */
export const CYCLING_WORKOUT_SYNTAX_RESOURCE = readFileSync(
  join(__dirname, 'cycling-workout-syntax.md'),
  'utf-8'
);
