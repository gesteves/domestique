/**
 * Compose Strava-ready activity descriptions for completed workouts.
 *
 * Block order (skip if data missing): Headline · Weather · Water temp · Power
 * · Heat strain · Whoop strain · Music. Pool swims are out of scope for the
 * Whoop-webhook caller; the orchestrator only handles non-pool activities.
 *
 * The headline + weather sentences come from a single Anthropic
 * `messages.parse()` call; every other block is built programmatically.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { NormalizedWorkout, PlayedSong, WhoopMatchedData } from '../types/index.js';
import { isSwimmingActivity } from './format-units.js';

const ZWIFT_PREFIX = '🗺️';

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
 * Separate an existing Intervals.icu description into:
 *   - `headline`: the first non-Zwift paragraph (preserved verbatim), or null.
 *   - `zwiftMapLine`: the first paragraph starting with the 🗺️ map prefix, or
 *     null. Per the skill rules, a Zwift map line is **not** a headline — it
 *     belongs at the top of the emoji block list.
 *
 * Paragraph = block of consecutive non-empty lines, separated by blank lines.
 */
export function splitExistingDescription(
  description: string | null | undefined
): { headline: string | null; zwiftMapLine: string | null } {
  if (!description) return { headline: null, zwiftMapLine: null };
  const trimmed = description.trim();
  if (!trimmed) return { headline: null, zwiftMapLine: null };

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let headline: string | null = null;
  let zwiftMapLine: string | null = null;
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith(ZWIFT_PREFIX)) {
      if (!zwiftMapLine) zwiftMapLine = paragraph;
    } else if (!headline) {
      headline = paragraph;
    }
    if (headline && zwiftMapLine) break;
  }

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
// Anthropic-backed helper
// ============================================================================

export interface PlannedSummaryInput {
  /** The planned workout's description (e.g. TR's structured workout text). */
  description: string;
}

export interface HeadlineWeatherInput {
  /** Planned-workout description to summarize. Null/undefined = no headline. */
  plannedSummary?: PlannedSummaryInput | null;
  /** Raw Intervals.icu weather description. When null/empty the model omits weather. */
  weatherDescription?: string | null;
  /** Whether the activity is indoor; weather is only generated for outdoor. */
  isIndoor?: boolean;
}

export interface HeadlineWeatherResult {
  /** One-sentence headline summarizing the planned workout, or null. */
  headline: string | null;
  /** Emoji that leads the weather block, or null when weather isn't generated. */
  weather_emoji: string | null;
  /** One-sentence weather description, or null when weather isn't generated. */
  weather_sentence: string | null;
}

const HeadlineWeatherSchema = z.object({
  headline: z
    .string()
    .nullable()
    .describe(
      'One-sentence summary of the planned workout description, ending with a period. Follow the HEADLINE RULES in the system prompt. Null when no planned workout description was provided.'
    ),
  weather_emoji: z
    .string()
    .nullable()
    .describe(
      'Single emoji that best represents the overall weather conditions. Null when weather input was not provided.'
    ),
  weather_sentence: z
    .string()
    .nullable()
    .describe(
      'One-sentence prose rewrite of the weather data. Follow the WEATHER RULES in the system prompt. Null when weather input was not provided.'
    ),
});

const HEADLINE_WEATHER_SYSTEM_PROMPT = `You produce two short fields for an athlete's training-log activity description: a one-sentence HEADLINE summarizing the planned workout, and a one-sentence WEATHER rewrite (with a leading emoji). Both fields are optional — output null when the corresponding input wasn't provided, and never invent data.

# HEADLINE RULES

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

# WEATHER RULES

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

# OUTPUT FORMATTING

- Return both \`headline\` and \`weather_sentence\` as raw text. Do not wrap the output in quotation marks.`;

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

/**
 * Single LLM call that produces (zero, one, or both of) the headline and the
 * weather sentence. Returns nulls in either field when the corresponding
 * input wasn't provided, or when the model declined to pick.
 *
 * Throws on transport / parse failure; callers catch and log so a flaky
 * Anthropic call never blocks the rest of the Whoop webhook work.
 */
export async function generateHeadlineAndWeather(
  input: HeadlineWeatherInput,
  model: string
): Promise<HeadlineWeatherResult> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return { headline: null, weather_emoji: null, weather_sentence: null };
  }

  const wantsHeadline = !!input.plannedSummary?.description?.trim();
  const wantsWeather =
    input.isIndoor !== true && !!input.weatherDescription && input.weatherDescription.trim().length > 0;

  if (!wantsHeadline && !wantsWeather) {
    return { headline: null, weather_emoji: null, weather_sentence: null };
  }

  const userParts: string[] = [];
  if (wantsHeadline) {
    userParts.push(
      'Planned workout description (summarize in one sentence):',
      input.plannedSummary!.description
    );
  } else {
    userParts.push('Planned workout description: not provided. Return null for headline.');
  }

  if (wantsWeather) {
    userParts.push('', `Weather data: ${input.weatherDescription}`);
  } else {
    userParts.push('', 'Weather data: not provided. Return null for weather_emoji and weather_sentence.');
  }

  const message = await anthropic.messages.parse({
    model,
    max_tokens: 512,
    system: HEADLINE_WEATHER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userParts.join('\n') }],
    output_config: { format: zodOutputFormat(HeadlineWeatherSchema) },
  });

  const parsed = message.parsed_output;
  return {
    headline: parsed?.headline ?? null,
    weather_emoji: parsed?.weather_emoji ?? null,
    weather_sentence: parsed?.weather_sentence ?? null,
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
 * Compose the full activity description. The caller is responsible for:
 *   - Skipping pool swims before reaching this function.
 *   - Checking the `domestique_description_generated` idempotency flag.
 *   - Wrapping the call in try/catch (a transient Anthropic failure must not
 *     bubble out of the Whoop webhook handler).
 */
export async function generateActivityDescription(
  input: GenerateDescriptionInput
): Promise<string> {
  const { activity, whoop, plannedSummary, model } = input;

  const { headline: existingHeadline, zwiftMapLine } = splitExistingDescription(activity.description);

  // If the athlete already wrote a headline, preserve it verbatim and skip
  // headline generation entirely. We still rewrite the weather (sentence).
  const llmResult = await generateHeadlineAndWeather(
    {
      plannedSummary: existingHeadline ? null : plannedSummary,
      weatherDescription: activity.weather_description ?? null,
      isIndoor: activity.is_indoor,
    },
    model
  );

  const headline = existingHeadline ?? llmResult.headline ?? null;

  const weatherBlock =
    llmResult.weather_emoji && llmResult.weather_sentence
      ? `${llmResult.weather_emoji} ${llmResult.weather_sentence}`
      : null;

  return composeBlocks({
    headline,
    zwiftMapLine,
    weather: weatherBlock,
    waterTemp: buildWaterTempBlock(activity),
    power: buildPowerBlock(activity),
    heat: buildHeatBlock(activity),
    whoop: buildWhoopBlock(activity, whoop),
    music: buildMusicBlock(activity.played_songs),
  });
}
