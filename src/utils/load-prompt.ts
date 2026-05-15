/**
 * Load a system-prompt markdown file from `src/prompts/` (or `dist/prompts/`
 * after build). All Anthropic-backed utils read their system prompts through
 * this helper so the prompt text lives as version-controlled Markdown next to
 * the code, not as escaped string constants inside TypeScript.
 *
 * The `npm run build` script copies `src/prompts/` to `dist/prompts/`, so the
 * relative path (`../prompts/<filename>`) resolves identically in dev (tsx)
 * and in the built output.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

export function loadPrompt(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), 'utf8');
}
