/**
 * Compose Strava-ready activity descriptions for completed workouts.
 *
 * Block order (skip if data missing): Headline · Weather · Water temp · Power
 * · Heat strain · Whoop strain · Music. Pool swims are out of scope for the
 * Whoop-webhook caller; the orchestrator only handles non-pool activities.
 *
 * Headline, weather sentence, and music artist picks each come from their own
 * focused Anthropic `messages.parse()` call. The orchestrator fires the
 * three concurrently with `Promise.allSettled`, so a single failed call
 * loses only its own block instead of the entire description.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { NormalizedWorkout, PlayedSong, WhoopMatchedData } from '../types/index.js';
import { isSwimmingActivity } from './format-units.js';

const ZWIFT_PREFIX = '🗺️';

/**
 * Detect lines that lead with a pictographic emoji. Used by
 * `splitExistingDescription` to strip our own stat lines (and any
 * LLM-picked weather emoji, which is drawn from an open set) before
 * regeneration so blocks aren't duplicated.
 *
 * The codepoint ranges cover Misc Symbols/Dingbats and the main emoji
 * blocks — enough for every emoji this module emits and every weather
 * emoji the LLM is likely to pick. Headline content (user prose or the
 * LLM headline) starts with a letter, so this only ever strips
 * stat-shaped lines.
 */
function startsWithEmoji(line: string): boolean {
  const cp = line.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x2600 && cp <= 0x27bf) ||  // Misc Symbols, Dingbats
    (cp >= 0x1f300 && cp <= 0x1f6ff) || // Misc Symbols & Pictographs, Transport
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // Supplemental Symbols
    (cp >= 0x1fa00 && cp <= 0x1faff)    // Symbols and Pictographs Extended-A
  );
}

// ============================================================================
// Block builders — pure functions
// ============================================================================

/**
 * Build the cycling power line. Returns null when the activity isn't cycling
 * or no power fields are present.
 *
 * Format: ⚡️ Avg 200 W · NP 200 W · IF 0.71 · TSS 98
 * Partial data renders only the fields that are present.
 */
export function buildPowerBlock(activity: NormalizedWorkout): string | null {
  if (activity.activity_type !== 'Cycling') return null;
  const parts: string[] = [];
  if (activity.average_power) parts.push(`Avg ${activity.average_power}`);
  if (activity.normalized_power) parts.push(`NP ${activity.normalized_power}`);
  if (activity.intensity_factor != null) parts.push(`IF ${activity.intensity_factor.toFixed(2)}`);
  if (activity.tss != null) parts.push(`TSS ${activity.tss}`);
  if (parts.length === 0) return null;
  return `⚡️ ${parts.join(' · ')}`;
}

/**
 * Build the CORE heat strain line. Requires both max and median HSI.
 * Skipped for all swimming activities (sensor inaccurate in water).
 */
export function buildHeatBlock(activity: NormalizedWorkout): string | null {
  if (!activity.activity_type || isSwimmingActivity(activity.activity_type)) return null;
  if (activity.max_heat_strain_index == null || activity.median_heat_strain_index == null) return null;
  return `🌡️ Max HSI ${activity.max_heat_strain_index.toFixed(1)} · Median HSI ${activity.median_heat_strain_index.toFixed(1)}`;
}

/**
 * Build the Whoop strain line. Skipped for all swimming activities.
 */
export function buildWhoopBlock(
  activity: NormalizedWorkout,
  whoop: WhoopMatchedData | null | undefined
): string | null {
  if (!activity.activity_type || isSwimmingActivity(activity.activity_type)) return null;
  if (!whoop || whoop.strain_score == null) return null;
  return `🔥 Whoop strain ${whoop.strain_score.toFixed(1)}`;
}

/**
 * Build the open-water swim water-temperature line. Pool swims (which have
 * `pool_length` set) and non-swim activities return null.
 */
export function buildWaterTempBlock(activity: NormalizedWorkout): string | null {
  if (activity.activity_type !== 'Swimming') return null;
  if (activity.pool_length) return null; // pool swim — out of scope for this caller anyway
  if (!activity.median_ambient_temperature) return null;
  return `💧 Water temperature ${activity.median_ambient_temperature}`;
}

/**
 * Build the music line from the LLM's pre-picked artist list.
 *
 * Format: 🎧 Tracy Chapman, Radiohead, Crowded House, Johnny Cash, Tears for Fears, and 18 more
 * The "and N more" suffix is added only when `remaining` is a positive integer.
 *
 * Defensive against an over-eager model: caps `topArtists` at 5 and floors
 * `remaining` at 0.
 */
export function buildMusicBlock(
  topArtists: string[] | null | undefined,
  remaining: number | null | undefined
): string | null {
  if (!topArtists || topArtists.length === 0) return null;
  const top = topArtists.slice(0, 5);
  const safeRemaining =
    typeof remaining === 'number' && Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  const suffix = safeRemaining > 0 ? `, and ${safeRemaining} more` : '';
  return `🎧 ${top.join(', ')}${suffix}`;
}

/**
 * Pick up to 5 unique artists at random from a played-songs list. Used as a
 * fallback only when `ANTHROPIC_API_KEY` is unset — the LLM normally handles
 * artist selection (with name normalization). This fallback is intentionally
 * dumb: case-sensitive uniqueness, no variant collapsing.
 */
export function pickRandomArtists(
  songs: PlayedSong[] | undefined
): { top: string[]; remaining: number } {
  if (!songs || songs.length === 0) return { top: [], remaining: 0 };
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const song of songs) {
    const artist = song.artist?.trim();
    if (!artist || seen.has(artist)) continue;
    seen.add(artist);
    unique.push(artist);
  }
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  const top = unique.slice(0, 5);
  const remaining = Math.max(0, unique.length - top.length);
  return { top, remaining };
}

/**
 * Separate an existing Intervals.icu description into:
 *   - `headline`: everything that isn't one of our stat lines, joined back
 *     together so multi-paragraph user prose round-trips. Null when nothing
 *     non-stat remains.
 *   - `zwiftMapLine`: the first line starting with the 🗺️ map prefix, or
 *     null. The Zwift map line is platform-generated by Zwift's sync, not
 *     by us, so it's preserved across regenerations.
 *
 * Operates line-by-line (not paragraph-by-paragraph) because our composer
 * joins stat lines with `\n` — they form a single multi-line paragraph that
 * a naive `startsWith` check would scoop up wholesale.
 */
export function splitExistingDescription(
  description: string | null | undefined
): { headline: string | null; zwiftMapLine: string | null } {
  if (!description?.trim()) return { headline: null, zwiftMapLine: null };

  let zwiftMapLine: string | null = null;
  const headlineLines: string[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (!line) {
      // Preserve blank-line boundaries so multi-paragraph user prose
      // round-trips. The final .trim() drops trailing blanks.
      headlineLines.push('');
      continue;
    }
    if (line.startsWith(ZWIFT_PREFIX)) {
      if (!zwiftMapLine) zwiftMapLine = line;
      continue;
    }
    if (startsWithEmoji(line)) continue;
    headlineLines.push(line);
  }

  // Collapse any internal runs of multiple blank lines down to a single
  // \n\n so paragraph spacing is normalized.
  const headline =
    headlineLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
  return { headline, zwiftMapLine };
}

export interface ComposeBlocksInput {
  headline?: string | null;
  weather?: string | null;
  waterTemp?: string | null;
  power?: string | null;
  heat?: string | null;
  whoop?: string | null;
  music?: string | null;
  zwiftMapLine?: string | null;
}

/**
 * Compose the final description.
 *   - Headline, when present, is separated from the emoji-block group by a
 *     single blank line (`\n\n`).
 *   - Emoji blocks (Zwift map line, weather, water temp, power, heat, whoop,
 *     music) are joined by a single newline (`\n`) — they read as a stacked
 *     stat block, not paragraphs.
 *   - The Zwift map line, when present, sits at the top of the emoji-block
 *     group (immediately before weather).
 */
export function composeBlocks(input: ComposeBlocksInput): string {
  const emojiBlocks: string[] = [];
  if (input.zwiftMapLine) emojiBlocks.push(input.zwiftMapLine);
  if (input.weather) emojiBlocks.push(input.weather);
  if (input.waterTemp) emojiBlocks.push(input.waterTemp);
  if (input.power) emojiBlocks.push(input.power);
  if (input.heat) emojiBlocks.push(input.heat);
  if (input.whoop) emojiBlocks.push(input.whoop);
  if (input.music) emojiBlocks.push(input.music);

  const emojiSection = emojiBlocks.join('\n');

  if (input.headline && emojiSection) return `${input.headline}\n\n${emojiSection}`;
  if (input.headline) return input.headline;
  return emojiSection;
}

// ============================================================================
// Anthropic-backed helpers
// ============================================================================

export interface PlannedSummaryInput {
  /** The planned workout's description (e.g. TR's structured workout text). */
  description: string;
}

export interface WeatherSentence {
  emoji: string;
  sentence: string;
}

export interface MusicSelection {
  top_artists: string[];
  remaining_artists: number;
}

/**
 * Per-call timeout for `messages.parse`. Generous for these tight prompts
 * (a 6–14 word headline, a one-sentence weather rewrite, or a list of 5
 * artist names) — anything longer is a degenerate stall. The webhook has
 * already responded 200 by the time these fire, so the timeout isn't on
 * the user-facing critical path; it bounds pile-up when Anthropic hiccups.
 */
const ANTHROPIC_TIMEOUT_MS = 30_000;

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

/**
 * Reset the cached client. Test-only.
 * @internal
 */
export function _resetDescriptionClientForTesting(): void {
  anthropicClient = null;
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

const HeadlineSchema = z.object({
  headline: z
    .string()
    .nullable()
    .describe(
      'One-sentence summary of the planned workout description, ending with a period. Follow the rules in the system prompt. Null when the planned-workout description is too sparse to summarize faithfully.'
    ),
});

const HEADLINE_SYSTEM_PROMPT = `You write a one-sentence HEADLINE summarizing an athlete's planned workout for their training-log activity description.

- You will be given exactly one planned-workout description. Summarize it in one sentence, ending with a period.
- **Match the brevity and shape of the examples below.** Target 6–14 words. The examples are the ceiling, not the floor.
- Mention only the workout's **structure**: total duration, interval pattern (count × duration), target intensity (% FTP, pace zone like "5K pace", or zone name like "endurance", "tempo", "sweet spot", "VO₂max", "threshold"), and recovery intervals when present.
- Use "VO₂max" (subscript 2, no dot) when referencing VO₂max efforts.
- **Do not include**, even if the source description mentions them: physiological purpose ("targeting fat metabolism", "aerobic power development", "lactate shuttling"), training adaptations, perceived-exertion guidance, cadence/RPM specs (unless cadence IS the workout's defining feature, e.g. a cadence drill), gearing notes, coaching rationale, or any "why" behind the workout.
- Tone: objective, neutral, technical. No exclamation marks. No marketing language ("crushed", "epic", "smashed", "huge", "killer"). No emojis in the headline.
- Scope: describe only the *planned* workout. Do not reference weather, perceived effort, fatigue, Whoop strain, or any post-activity outcome.
- If the planned-workout description is too sparse to summarize faithfully, return null rather than inventing structure.

Examples (study the length and how they strip rationale to just structure):
- 2 hours of endurance at 70-75% FTP.
- 7×3-minute intervals at 5K pace with 3-minute recoveries.
- 6×5-min at 10K pace with 3-min recoveries.
- 1 hour of VO₂max with two sets of 3×2.5 min at 118% FTP.
- 3×12-min over-unders at 90–103% FTP, with 2×24-min endurance blocks.
- 2-hour tempo ride at 65–90% FTP.

Counter-example — DO NOT produce headlines like this:
- ❌ "2-hour aerobic endurance ride at 68–75% FTP, targeting fat metabolism and aerobic power development with cadence above 85 rpm."
- ✅ "2 hours of endurance at 68–75% FTP."

Return \`headline\` as raw text. Do not wrap the output in quotation marks.`;

/**
 * Summarize a planned-workout description into a one-sentence headline.
 *
 * Returns null when the input is empty/whitespace, when the Anthropic API key
 * isn't configured, or when the model declined to summarize a sparse
 * description. Throws on transport/parse failure; the orchestrator catches
 * per-call rejections so a single failure can't lose the other blocks.
 */
export async function generateHeadline(
  plannedDescription: string,
  model: string
): Promise<string | null> {
  if (!plannedDescription?.trim()) return null;
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  const message = await anthropic.messages.parse(
    {
      model,
      max_tokens: 512,
      system: HEADLINE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Planned workout description (summarize in one sentence):\n${plannedDescription}`,
        },
      ],
      output_config: { format: zodOutputFormat(HeadlineSchema) },
    },
    { timeout: ANTHROPIC_TIMEOUT_MS }
  );

  return message.parsed_output?.headline ?? null;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

const WeatherSchema = z.object({
  weather_emoji: z
    .string()
    .nullable()
    .describe(
      'Single emoji that best represents the overall weather conditions. Null when the weather input is too sparse to characterize.'
    ),
  weather_sentence: z
    .string()
    .nullable()
    .describe(
      'One-sentence prose rewrite of the weather data, following the rules in the system prompt. Null when the weather input is too sparse to characterize.'
    ),
});

const WEATHER_SYSTEM_PROMPT = `You rewrite raw weather data into one sentence of natural prose for an athlete's training-log activity description, and pick a single representative emoji.

- Rewrite the provided weather data as one sentence of natural flowing prose — not a list of data points. Prioritize readability over completeness; omit minor data points if they disrupt the flow.
- Open the sentence with a summary of the conditions, chosen from (but not limited to): clear, sunny, mostly sunny, partly cloudy, overcast, windy, light rain, heavy rain, snow. Infer this from wind speeds, precipitation amount, and cloud coverage in the input.
- Assume any missing data point is zero (no cloud percentage in the input → 0% cloud; no rain field → no rain; etc.).
- Use the same units as the source data. Round all numbers.
- If — and only if — the source data mentions wind direction relative to the route (tailwind, headwind, crosswind), preserve that phrasing. Never invent route-relative wind information; use compass direction (W, WSW, NNE, etc.) when the source provides only that.
- \`weather_emoji\` is a single emoji that best represents the conditions overall.

Style:
- Sentence case, no trailing period.
- Use the serial comma.
- Use en dashes for ranges where both ends are positive (e.g. 3–5°C, 7–21 km/h).
- Use "to" instead of an en dash when one or both ends of the range are negative (e.g. "−2 to 2°C", "−3 to −1°C").
- Add a space before non-temperature units (20 km/h, not 20km/h).
- Do not add a space before temperature units (55°F, not 55 °F).

Examples:
- 🌤️ Mostly sunny with light W winds of 7–21 km/h gusting to 26, temps 10–14°C (feels like 5–9°C), and a slight tailwind
- ☁️ Overcast with light-to-moderate WSW winds of 14–23 km/h gusting to 31, temps 8–13°C (feels like 2–8°C)
- ☁️ Overcast with a light NNW breeze of 3–7 km/h gusting to 21, temps around 20°C (feels like 17°C), and mostly tailwind
- ☀️ Sunny skies with SW winds of 1–5 mph and gusts up to 11 mph, temperatures ranging from 51–61°F with an average feel of 49°F

Return \`weather_sentence\` as raw text. Do not wrap the output in quotation marks.`;

/**
 * Rewrite a raw weather description as one sentence + a leading emoji.
 *
 * Returns null when the activity is indoor, when the description is empty,
 * when no API key is configured, or when the model declined to characterize
 * the conditions. Throws on transport/parse failure.
 */
export async function generateWeatherSentence(
  weatherDescription: string,
  isIndoor: boolean,
  model: string
): Promise<WeatherSentence | null> {
  if (isIndoor) return null;
  if (!weatherDescription?.trim()) return null;
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  const message = await anthropic.messages.parse(
    {
      model,
      max_tokens: 512,
      system: WEATHER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Weather data: ${weatherDescription}`,
        },
      ],
      output_config: { format: zodOutputFormat(WeatherSchema) },
    },
    { timeout: ANTHROPIC_TIMEOUT_MS }
  );

  const parsed = message.parsed_output;
  if (!parsed?.weather_emoji || !parsed?.weather_sentence) return null;
  return { emoji: parsed.weather_emoji, sentence: parsed.weather_sentence };
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

const MusicSchema = z.object({
  top_artists: z
    .array(z.string())
    .nullable()
    .describe(
      'Up to 5 artist names that best represent the played-songs list. Collapse trivial variants (e.g. "The Foo Fighters" → "Foo Fighters", "Beyonce" → "Beyoncé") to one canonical form, choosing the form most commonly used for the artist.'
    ),
  remaining_artists: z
    .number()
    .int()
    .nullable()
    .describe(
      'Count of unique artists in the input — after the same normalization — NOT named in top_artists. 0 when 5 or fewer unique artists exist after normalization.'
    ),
});

const MUSIC_SYSTEM_PROMPT = `You pick up to 5 representative artists from a list of songs an athlete listened to during a workout, for their training-log activity description.

- You will be given a list of played songs, one per line, in the form \`- Artist - Song Title\`. Each line is one scrobble; repeats mean the track was played more than once.
- Pick up to 5 artists that best represent the playlist as a whole. You may use any criteria, including (but not limited to): artists with the most repeated tracks, artists with the most distinct songs played, artists whose tracks dominate stretches of the listening. A repeated track is a strong signal of taste.
- **Normalize artist names**: collapse trivial variants to one canonical form. Examples: "Foo Fighters" and "The Foo Fighters" → "Foo Fighters"; "Beyoncé" and "Beyonce" → "Beyoncé". Choose the spelling most commonly used for the artist.
- Do not invent artists. Every name you emit in \`top_artists\` must appear in the input (in the chosen canonical form).
- If fewer than 5 unique artists are present (after normalization), return only those — do not pad.
- \`remaining_artists\` is the count of unique artists (after normalization) NOT in \`top_artists\`. Think step by step: count distinct normalized artists in the input, subtract \`top_artists.length\`, floor at 0. Be precise — readers will compare this number against the playlist they remember.`;

/**
 * Pick up to 5 representative artists from a played-songs list, with the
 * model handling variant-name normalization (e.g. "Foo Fighters" vs
 * "The Foo Fighters").
 *
 * Returns null when no songs are provided, when no API key is configured, or
 * when the model declined to pick. Throws on transport/parse failure.
 */
export async function generateMusicSelection(
  playedSongs: PlayedSong[],
  model: string
): Promise<MusicSelection | null> {
  if (!playedSongs || playedSongs.length === 0) return null;
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  const lines: string[] = ['Played songs:'];
  for (const song of playedSongs) {
    const artist = song.artist?.trim();
    const title = song.name?.trim();
    if (!artist || !title) continue;
    lines.push(`- ${artist} - ${title}`);
  }
  if (lines.length === 1) return null; // every song was unusable

  const message = await anthropic.messages.parse(
    {
      model,
      max_tokens: 256,
      system: MUSIC_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lines.join('\n') }],
      output_config: { format: zodOutputFormat(MusicSchema) },
    },
    { timeout: ANTHROPIC_TIMEOUT_MS }
  );

  const parsed = message.parsed_output;
  if (!parsed?.top_artists || parsed.top_artists.length === 0) return null;
  return {
    top_artists: parsed.top_artists,
    remaining_artists:
      typeof parsed.remaining_artists === 'number' ? parsed.remaining_artists : 0,
  };
}

// ============================================================================
// Orchestrator
// ============================================================================

export interface GenerateDescriptionInput {
  activity: NormalizedWorkout;
  whoop: WhoopMatchedData | null;
  /** Planned-workout description to summarize as the headline. Null = no headline. */
  plannedSummary: PlannedSummaryInput | null;
  model: string;
}

/**
 * Unwrap a `Promise.allSettled` result, logging the rejection (with the
 * given label) and returning null when the promise rejected. Letting the
 * three LLM calls fail independently is the whole point of the split — a
 * flaky music call shouldn't lose the headline.
 */
function settled<T>(
  result: PromiseSettledResult<T>,
  label: string
): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`[ActivityDescription] ${label} call failed:`, result.reason);
  return null;
}

/**
 * Compose the full activity description. The caller is responsible for:
 *   - Skipping pool swims before reaching this function.
 *   - Checking the `domestique_description_generated` idempotency flag.
 *   - Wrapping the call in try/catch (a catastrophic failure before any LLM
 *     call is made must not bubble out of the Whoop webhook handler).
 *
 * Per-LLM-call failures are absorbed via `Promise.allSettled`: if e.g. the
 * music call rejects, the description is still composed from the surviving
 * headline + weather blocks (and the music line is dropped), with a
 * `[ActivityDescription]` warning logged.
 */
export async function generateActivityDescription(
  input: GenerateDescriptionInput
): Promise<string> {
  const { activity, whoop, plannedSummary, model } = input;

  const { headline: existingHeadline, zwiftMapLine } = splitExistingDescription(activity.description);

  // Athlete already wrote a headline → preserve verbatim and skip the
  // headline LLM call entirely. Weather + music still go to the LLM.
  const headlinePromise: Promise<string | null> =
    existingHeadline || !plannedSummary?.description
      ? Promise.resolve(null)
      : generateHeadline(plannedSummary.description, model);

  const weatherPromise = generateWeatherSentence(
    activity.weather_description ?? '',
    activity.is_indoor === true,
    model
  );

  const musicPromise = generateMusicSelection(activity.played_songs ?? [], model);

  const [headlineResult, weatherResult, musicResult] = await Promise.allSettled([
    headlinePromise,
    weatherPromise,
    musicPromise,
  ]);

  const headline =
    existingHeadline ?? settled(headlineResult, 'headline') ?? null;
  const weather = settled(weatherResult, 'weather');
  const music = settled(musicResult, 'music');

  const weatherBlock = weather ? `${weather.emoji} ${weather.sentence}` : null;

  // Random fallback whenever the LLM didn't give us artists but the
  // activity has scrobbles. Covers: no API key (the call short-circuits to
  // null), the call rejected (settled returned null), or the model
  // explicitly declined. The other LLM-driven fields (headline, weather)
  // have no programmatic fallback because they're prose; artists are just
  // a list.
  let topArtists = music?.top_artists ?? null;
  let remainingArtists = music?.remaining_artists ?? null;
  if (topArtists === null && activity.played_songs && activity.played_songs.length > 0) {
    const fallback = pickRandomArtists(activity.played_songs);
    topArtists = fallback.top;
    remainingArtists = fallback.remaining;
  }

  return composeBlocks({
    headline,
    zwiftMapLine,
    weather: weatherBlock,
    waterTemp: buildWaterTempBlock(activity),
    power: buildPowerBlock(activity),
    heat: buildHeatBlock(activity),
    whoop: buildWhoopBlock(activity, whoop),
    music: buildMusicBlock(topArtists, remainingArtists),
  });
}
