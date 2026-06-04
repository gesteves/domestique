/**
 * Compose Strava-ready activity descriptions for completed workouts.
 *
 * Layout: an optional user-written headline (preserved verbatim — we never
 * generate one) sits above a stack of emoji-prefixed stat lines, in order:
 * Planned summary (🗓️) · Weather · Water temp · Power · Heat strain ·
 * Whoop strain · Music. Pool swims are out of scope for the Whoop-webhook
 * caller; the orchestrator only handles non-pool activities.
 *
 * The planned summary and weather sentence each come from their own focused
 * Anthropic `messages.parse()` call; the orchestrator fires them concurrently
 * with `Promise.allSettled`, so a single failed call loses only its own line
 * instead of the entire description. The music line is built programmatically
 * from the scrobbled-songs list — no LLM involved.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logWarn, logApiCall } from './logger.js';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { NormalizedWorkout, PlayedSong, WhoopMatchedData } from '../types/index.js';
import { formatPercent, isSwimmingActivity } from './format-units.js';
import { loadPrompt } from './load-prompt.js';

// ──────────────────────────────────────────────────────────────────────────
// Pure block builders & composition (no I/O — safe to unit-test in isolation)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Detect lines that lead with a pictographic emoji. Used by
 * `splitExistingDescription` to strip our own stat lines (and any
 * LLM-picked weather emoji, which is drawn from an open set, plus the
 * Zwift map line if present) before regeneration so blocks aren't
 * duplicated.
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
 * Build the CORE heat line.
 *
 * Combines two independent signals:
 *   - Per-activity HSI (Max + Median). Requires both fields.
 *   - Daily CoreHeatAdaptationScore. Skipped when null or ≤ 0.
 *
 * Both signals are suppressed for swimming activities — the CORE sensor
 * is inaccurate in water, and heat adaptation isn't a relevant lens for
 * swim sessions.
 *
 * Format examples:
 *   🌡️ Max HSI 2.5 · Median HSI 1.7
 *   🌡️ Max HSI 2.5 · Median HSI 1.7 · 72% heat adapted
 *   🌡️ 72% heat adapted
 *
 * Returns null when neither signal is present.
 */
export function buildHeatBlock(
  activity: NormalizedWorkout,
  heatAdaptationScore: number | null | undefined
): string | null {
  if (!activity.activity_type || isSwimmingActivity(activity.activity_type)) return null;

  const hasHsi =
    activity.max_heat_strain_index != null && activity.median_heat_strain_index != null;

  const hasAdaptation =
    typeof heatAdaptationScore === 'number' &&
    Number.isFinite(heatAdaptationScore) &&
    heatAdaptationScore > 0;

  if (!hasHsi && !hasAdaptation) return null;

  const parts: string[] = [];
  if (hasHsi) {
    parts.push(`Max HSI ${activity.max_heat_strain_index!.toFixed(1)}`);
    parts.push(`Median HSI ${activity.median_heat_strain_index!.toFixed(1)}`);
  }
  if (hasAdaptation) {
    parts.push(`${formatPercent(heatAdaptationScore!)} heat adapted`);
  }

  return `🌡️ ${parts.join(' · ')}`;
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
  return `🔥 ${whoop.strain_score.toFixed(1)} Whoop Strain`;
}

/**
 * Build the open-water swim water-temperature line. Pool swims (which have
 * `pool_length` set) and non-swim activities return null. `formatTemperature`
 * always emits one decimal (`.toFixed(1)`); strip a trailing `.0` so whole
 * degrees render as `59 °F` rather than `59.0 °F`.
 */
export function buildWaterTempBlock(activity: NormalizedWorkout): string | null {
  if (activity.activity_type !== 'Swimming') return null;
  if (activity.pool_length) return null; // pool swim — out of scope for this caller anyway
  if (!activity.median_ambient_temperature) return null;
  const temp = activity.median_ambient_temperature.replace(/\.0(?=\s|$)/, '');
  return `💧 Water temperature ${temp}`;
}

/**
 * Build the music line.
 *
 * Format: 🎧 Tracy Chapman, Radiohead, Crowded House, Johnny Cash, Tears for Fears, and 18 more
 * The "and N more" suffix is added only when more than 5 unique artists exist.
 */
export function buildMusicBlock(songs: PlayedSong[] | undefined): string | null {
  if (!songs || songs.length === 0) return null;
  const { top, remaining } = pickTopArtists(songs);
  if (top.length === 0) return null;
  const suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return `🎧 ${top.join(', ')}${suffix}`;
}

/**
 * Pick the top-5 artists from a played-songs list and report how many other
 * unique artists were dropped. Scoring is deterministic:
 *
 *   score = 2 × (notable-track count) + (total play count)
 *
 * A track counts as **notable** if the athlete loved it OR played it more
 * than once during this activity — repeating a track during a workout is
 * treated as a "love"-equivalent signal of taste. The +2 boost is per unique
 * notable track, so an artist with several notable tracks compounds.
 *
 * Ties break: score desc → total plays desc → earliest first-play-time asc
 * (chronological — the artist that kicked off the playlist wins). When even
 * that ties, the insertion order of the underlying Map (first-seen) holds
 * via stable sort.
 */
export function pickTopArtists(
  songs: PlayedSong[]
): { top: string[]; remaining: number } {
  if (songs.length === 0) return { top: [], remaining: 0 };

  interface TrackStat {
    plays: number;
    loved: boolean;
  }

  interface ArtistAggregate {
    plays: number;
    firstPlayedAt: string;
    tracks: Map<string, TrackStat>;
  }

  const byArtist = new Map<string, ArtistAggregate>();
  for (const song of songs) {
    const artist = song.artist?.trim();
    if (!artist) continue;
    const trackName = song.name?.trim() ?? '';

    let agg = byArtist.get(artist);
    if (!agg) {
      agg = { plays: 0, firstPlayedAt: song.played_at, tracks: new Map() };
      byArtist.set(artist, agg);
    }

    agg.plays += 1;
    if (song.played_at && song.played_at < agg.firstPlayedAt) {
      agg.firstPlayedAt = song.played_at;
    }

    const track = agg.tracks.get(trackName) ?? { plays: 0, loved: false };
    track.plays += 1;
    if (song.loved) track.loved = true;
    agg.tracks.set(trackName, track);
  }

  const ranked = Array.from(byArtist.entries())
    .map(([artist, agg]) => {
      let notableTracks = 0;
      for (const track of agg.tracks.values()) {
        if (track.loved || track.plays > 1) notableTracks += 1;
      }
      return {
        artist,
        plays: agg.plays,
        notableTracks,
        firstPlayedAt: agg.firstPlayedAt,
        score: 2 * notableTracks + agg.plays,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.plays !== a.plays) return b.plays - a.plays;
      // Chronological by first appearance in the playlist (earliest wins).
      // ISO 8601 strings are lexicographically ordered, so string compare works.
      return a.firstPlayedAt.localeCompare(b.firstPlayedAt);
    });

  const top = ranked.slice(0, 5).map((r) => r.artist);
  const remaining = Math.max(0, ranked.length - top.length);
  return { top, remaining };
}

/**
 * Extract a user-written headline from an existing Intervals.icu
 * description: everything that isn't one of our emoji-prefixed stat lines,
 * joined back together so multi-paragraph user prose round-trips. Returns
 * null when nothing non-stat remains.
 *
 * Operates line-by-line (not paragraph-by-paragraph) because our composer
 * joins stat lines with `\n` — they form a single multi-line paragraph that
 * a naive `startsWith` check would scoop up wholesale. Lines that lead with
 * any pictographic emoji (our own stat prefixes, the LLM-picked weather
 * emoji, and the Zwift sync's 🗺️ map line) are all stripped.
 */
export function splitExistingDescription(
  description: string | null | undefined
): string | null {
  if (!description?.trim()) return null;

  const headlineLines: string[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (!line) {
      // Preserve blank-line boundaries so multi-paragraph user prose
      // round-trips. The final .trim() drops trailing blanks.
      headlineLines.push('');
      continue;
    }
    if (startsWithEmoji(line)) continue;
    headlineLines.push(line);
  }

  // Collapse any internal runs of multiple blank lines down to a single
  // \n\n so paragraph spacing is normalized.
  return headlineLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

export interface ComposeBlocksInput {
  /** User-preserved prose only — we never generate this. Sits above the emoji block. */
  headline?: string | null;
  /** LLM summary of the planned workout. Renders as the first emoji line with a 🗓️ prefix. */
  plannedSummary?: string | null;
  weather?: string | null;
  waterTemp?: string | null;
  power?: string | null;
  heat?: string | null;
  whoop?: string | null;
  music?: string | null;
}

/**
 * Compose the final description.
 *   - Headline, when present (only user-preserved prose ever lives here),
 *     is separated from the emoji-block group by a single blank line.
 *   - Emoji blocks (planned summary, weather, water temp, power, heat,
 *     whoop, music) are joined by single newlines — they read as a stacked
 *     stat block, not paragraphs.
 *   - Planned summary leads the emoji group (contextual: what was planned),
 *     followed by conditions and results.
 */
export function composeBlocks(input: ComposeBlocksInput): string {
  const emojiBlocks: string[] = [];
  if (input.plannedSummary) emojiBlocks.push(`🗓️ ${input.plannedSummary}`);
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

// ──────────────────────────────────────────────────────────────────────────
// Anthropic-backed helpers (network I/O — generators call messages.parse())
// ──────────────────────────────────────────────────────────────────────────

export interface PlannedSummaryInput {
  /** The planned workout's description (e.g. TR's structured workout text). */
  description: string;
}

export interface WeatherSentence {
  emoji: string;
  sentence: string;
}

/**
 * Per-call timeout for `messages.parse`. Generous for these tight prompts
 * (a 6–14 word headline or a one-sentence weather rewrite) — anything longer
 * is a degenerate stall. The webhook has already responded 200 by the time
 * these fire, so the timeout isn't on the user-facing critical path; it
 * bounds pile-up when Anthropic hiccups.
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
// Planned-workout summary
// ---------------------------------------------------------------------------

const PlannedSummarySchema = z.object({
  planned_summary: z
    .string()
    .nullable()
    .describe(
      'One-sentence summary of the planned workout description. No trailing period. Follow the rules in the system prompt. Null when the planned-workout description is too sparse to summarize faithfully.'
    ),
});

const PLANNED_SUMMARY_SYSTEM_PROMPT = loadPrompt('planned-summary.md');

/**
 * Summarize a planned-workout description into a one-sentence stat-line
 * phrase (no trailing period — the composer renders it as one of the
 * emoji-prefixed stat lines).
 *
 * Returns null when the input is empty/whitespace, when the Anthropic API key
 * isn't configured, or when the model declined to summarize a sparse
 * description. Throws on transport/parse failure; the orchestrator catches
 * per-call rejections so a single failure can't lose the other blocks.
 */
export async function generatePlannedSummary(
  plannedDescription: string,
  model: string
): Promise<string | null> {
  if (!plannedDescription?.trim()) return null;
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  logApiCall('Anthropic', `planned-summary (model=${model})`, 'messages.parse');
  const message = await anthropic.messages.parse(
    {
      model,
      max_tokens: 512,
      system: PLANNED_SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Planned workout description (summarize in one sentence):\n${plannedDescription}`,
        },
      ],
      output_config: { format: zodOutputFormat(PlannedSummarySchema) },
    },
    { timeout: ANTHROPIC_TIMEOUT_MS }
  );

  return message.parsed_output?.planned_summary ?? null;
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

const WEATHER_SYSTEM_PROMPT = loadPrompt('weather-sentence.md');

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

  logApiCall('Anthropic', `weather-sentence (model=${model})`, 'messages.parse');
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

// ============================================================================
// Orchestrator
// ============================================================================

export interface GenerateDescriptionInput {
  activity: NormalizedWorkout;
  whoop: WhoopMatchedData | null;
  /** Planned-workout description to summarize as a 🗓️ stat line. Null = no plan line. */
  plannedSummary: PlannedSummaryInput | null;
  /** Daily CoreHeatAdaptationScore (0–100) for the activity's date. Null = unavailable; ≤0 = suppress. */
  heatAdaptationScore: number | null;
  model: string;
}

/**
 * Unwrap a `Promise.allSettled` result, logging the rejection (with the
 * given label) and returning null when the promise rejected. Letting the
 * two LLM calls fail independently is the whole point of the split — a
 * flaky weather call shouldn't lose the planned summary.
 */
function settled<T>(
  result: PromiseSettledResult<T>,
  label: string
): T | null {
  if (result.status === 'fulfilled') return result.value;
  logWarn('ActivityDescription', `${label} call failed`, result.reason);
  return null;
}

/**
 * Compose the full activity description. The caller is responsible for:
 *   - Skipping pool swims before reaching this function.
 *   - Wrapping the call in try/catch (a catastrophic failure before any LLM
 *     call is made must not bubble out of the Whoop webhook handler).
 *
 * Per-LLM-call failures are absorbed via `Promise.allSettled`: if e.g. the
 * weather call rejects, the description is still composed from the surviving
 * planned-summary block (and the weather line is dropped), with a
 * `[ActivityDescription]` warning logged. The music line is built
 * programmatically and never depends on an LLM call.
 */
export async function generateActivityDescription(
  input: GenerateDescriptionInput
): Promise<string> {
  const { activity, whoop, plannedSummary, heatAdaptationScore, model } = input;

  // We never emit a headline ourselves anymore — anything in this slot is
  // user-written prose, preserved verbatim across regenerations. The
  // planned-workout summary now lives in the emoji block (🗓️ prefix) and
  // is regenerated on every run.
  const existingHeadline = splitExistingDescription(activity.description);

  const plannedPromise: Promise<string | null> = plannedSummary?.description
    ? generatePlannedSummary(plannedSummary.description, model)
    : Promise.resolve(null);

  const weatherPromise = generateWeatherSentence(
    activity.weather_description ?? '',
    activity.is_indoor === true,
    model
  );

  const [plannedResult, weatherResult] = await Promise.allSettled([
    plannedPromise,
    weatherPromise,
  ]);

  const planned = settled(plannedResult, 'plannedSummary');
  const weather = settled(weatherResult, 'weather');

  const weatherBlock = weather ? `${weather.emoji} ${weather.sentence}` : null;

  return composeBlocks({
    headline: existingHeadline,
    plannedSummary: planned,
    weather: weatherBlock,
    waterTemp: buildWaterTempBlock(activity),
    power: buildPowerBlock(activity),
    heat: buildHeatBlock(activity, heatAdaptationScore),
    whoop: buildWhoopBlock(activity, whoop),
    music: buildMusicBlock(activity.played_songs),
  });
}
