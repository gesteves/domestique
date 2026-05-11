import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NormalizedWorkout, PlayedSong, WhoopMatchedData } from '../../src/types/index.js';
import {
  buildPowerBlock,
  buildHeatBlock,
  buildWhoopBlock,
  buildWaterTempBlock,
  buildMusicBlock,
  pickRandomArtists,
  splitExistingDescription,
  composeBlocks,
  generatePlannedSummary,
  generateWeatherSentence,
  generateMusicSelection,
  generateActivityDescription,
  _resetDescriptionClientForTesting,
} from '../../src/utils/activity-description.js';

function workout(overrides: Partial<NormalizedWorkout> = {}): NormalizedWorkout {
  return {
    id: 'a1',
    start_time: '2024-12-15T10:00:00+00:00',
    activity_type: 'Cycling',
    source: 'intervals.icu',
    ...overrides,
  };
}

function song(
  artist: string,
  opts: { loved?: boolean; name?: string; playedAt?: string } = {}
): PlayedSong {
  return {
    name: opts.name ?? `${artist} - some song`,
    artist,
    album: 'Album',
    url: 'https://example.com',
    played_at: opts.playedAt ?? '2024-12-15T10:10:00Z',
    ...(opts.loved ? { loved: true } : {}),
  };
}

describe('buildPowerBlock', () => {
  it('returns null for non-cycling activities', () => {
    expect(buildPowerBlock(workout({ activity_type: 'Running', average_power: '200 W' }))).toBeNull();
  });

  it('renders all four power fields when present', () => {
    const block = buildPowerBlock(
      workout({
        average_power: '200 W',
        normalized_power: '210 W',
        intensity_factor: 0.713,
        tss: 98,
      })
    );
    expect(block).toBe('⚡️ Avg 200 W · NP 210 W · IF 0.71 · TSS 98');
  });

  it('skips fields that are missing', () => {
    const block = buildPowerBlock(workout({ normalized_power: '210 W', tss: 50 }));
    expect(block).toBe('⚡️ NP 210 W · TSS 50');
  });

  it('returns null when cycling but no power data', () => {
    expect(buildPowerBlock(workout({ activity_type: 'Cycling' }))).toBeNull();
  });
});

describe('buildHeatBlock', () => {
  it('returns null when neither HSI nor adaptation score is available', () => {
    expect(buildHeatBlock(workout(), null)).toBeNull();
    expect(buildHeatBlock(workout({ max_heat_strain_index: 2 }), null)).toBeNull();
    expect(buildHeatBlock(workout({ median_heat_strain_index: 1 }), null)).toBeNull();
  });

  it('renders HSI alone when only HSI is present', () => {
    const block = buildHeatBlock(
      workout({ max_heat_strain_index: 2.47, median_heat_strain_index: 1.71 }),
      null
    );
    expect(block).toBe('🌡️ Max HSI 2.5 · Median HSI 1.7');
  });

  it('renders adaptation alone when only the score is present', () => {
    expect(buildHeatBlock(workout(), 72)).toBe('🌡️ 72% heat adapted');
  });

  it('renders both when HSI and adaptation are present', () => {
    const block = buildHeatBlock(
      workout({ max_heat_strain_index: 2.47, median_heat_strain_index: 1.71 }),
      72
    );
    expect(block).toBe('🌡️ Max HSI 2.5 · Median HSI 1.7 · 72% heat adapted');
  });

  it('suppresses the adaptation suffix when the score is ≤ 0', () => {
    expect(
      buildHeatBlock(workout({ max_heat_strain_index: 2, median_heat_strain_index: 1 }), 0)
    ).toBe('🌡️ Max HSI 2.0 · Median HSI 1.0');
    expect(
      buildHeatBlock(workout({ max_heat_strain_index: 2, median_heat_strain_index: 1 }), -5)
    ).toBe('🌡️ Max HSI 2.0 · Median HSI 1.0');
  });

  it('suppresses both signals for swimming activities', () => {
    // HSI is unreliable in water; heat adaptation isn't a relevant lens
    // for swim sessions either. The whole line goes away.
    expect(
      buildHeatBlock(
        workout({ activity_type: 'Swimming', max_heat_strain_index: 2, median_heat_strain_index: 1 }),
        72
      )
    ).toBeNull();
    expect(buildHeatBlock(workout({ activity_type: 'Swimming' }), 72)).toBeNull();
  });

  it('rounds non-integer scores via formatPercent (0 decimals)', () => {
    expect(buildHeatBlock(workout(), 72.6)).toBe('🌡️ 73% heat adapted');
  });
});

describe('buildWhoopBlock', () => {
  const whoop: WhoopMatchedData = { id: 'w1', strain_score: 16.42 };

  it('renders the strain score rounded to one decimal', () => {
    expect(buildWhoopBlock(workout(), whoop)).toBe('🔥 Whoop strain 16.4');
  });

  it('returns null when no whoop data', () => {
    expect(buildWhoopBlock(workout(), null)).toBeNull();
    expect(buildWhoopBlock(workout(), undefined)).toBeNull();
  });

  it('is skipped for swimming', () => {
    expect(buildWhoopBlock(workout({ activity_type: 'Swimming' }), whoop)).toBeNull();
  });
});

describe('buildWaterTempBlock', () => {
  it('renders water temperature for open-water swims', () => {
    const block = buildWaterTempBlock(
      workout({ activity_type: 'Swimming', median_ambient_temperature: '21°C' })
    );
    expect(block).toBe('💧 Water temperature 21°C');
  });

  it('is skipped for pool swims (pool_length present)', () => {
    expect(
      buildWaterTempBlock(
        workout({ activity_type: 'Swimming', pool_length: '25 m', median_ambient_temperature: '21°C' })
      )
    ).toBeNull();
  });

  it('is skipped for non-swim activities', () => {
    expect(
      buildWaterTempBlock(
        workout({ activity_type: 'Cycling', median_ambient_temperature: '21°C' })
      )
    ).toBeNull();
  });
});

describe('buildMusicBlock', () => {
  it('joins the LLM-picked artists with commas and omits suffix when remaining=0', () => {
    expect(buildMusicBlock(['A', 'B', 'C'], 0)).toBe('🎧 A, B, C');
  });

  it('appends "and N more" when remaining > 0', () => {
    expect(buildMusicBlock(['A', 'B', 'C', 'D', 'E'], 2)).toBe('🎧 A, B, C, D, E, and 2 more');
  });

  it('returns null when topArtists is null/undefined/empty', () => {
    expect(buildMusicBlock(null, null)).toBeNull();
    expect(buildMusicBlock(undefined, undefined)).toBeNull();
    expect(buildMusicBlock([], 5)).toBeNull();
  });

  it('caps an over-eager model at 5 artists', () => {
    expect(buildMusicBlock(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 0)).toBe(
      '🎧 A, B, C, D, E'
    );
  });

  it('floors a negative or non-integer remaining at 0', () => {
    expect(buildMusicBlock(['A', 'B'], -3)).toBe('🎧 A, B');
    expect(buildMusicBlock(['A', 'B'], NaN as unknown as number)).toBe('🎧 A, B');
    expect(buildMusicBlock(['A', 'B'], 2.7)).toBe('🎧 A, B, and 2 more');
  });
});

describe('pickRandomArtists', () => {
  it('returns empty on empty input', () => {
    expect(pickRandomArtists(undefined)).toEqual({ top: [], remaining: 0 });
    expect(pickRandomArtists([])).toEqual({ top: [], remaining: 0 });
  });

  it('returns every unique artist when 5 or fewer exist', () => {
    const { top, remaining } = pickRandomArtists([
      song('A'), song('A'), song('A'),
      song('B'), song('B'),
      song('C'),
    ]);
    expect(top.sort()).toEqual(['A', 'B', 'C']);
    expect(remaining).toBe(0);
  });

  it('picks 5 and reports remaining when there are more than 5 unique artists', () => {
    const { top, remaining } = pickRandomArtists([
      song('A'), song('B'), song('C'), song('D'),
      song('E'), song('F'), song('G'), song('H'),
    ]);
    expect(top).toHaveLength(5);
    expect(new Set(top).size).toBe(5);
    for (const artist of top) {
      expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']).toContain(artist);
    }
    expect(remaining).toBe(3);
  });

  it('skips blank/missing artists and treats names case-sensitively', () => {
    const { top, remaining } = pickRandomArtists([
      song('A'),
      song('a'),
      { name: 'X', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: '' },
    ]);
    expect(top.sort()).toEqual(['A', 'a']);
    expect(remaining).toBe(0);
  });
});

describe('splitExistingDescription', () => {
  it('handles empty input', () => {
    expect(splitExistingDescription(null)).toEqual({ headline: null, zwiftMapLine: null });
    expect(splitExistingDescription('')).toEqual({ headline: null, zwiftMapLine: null });
    expect(splitExistingDescription('   \n   ')).toEqual({ headline: null, zwiftMapLine: null });
  });

  it('treats a non-Zwift first paragraph as the headline', () => {
    expect(splitExistingDescription('Felt great today!')).toEqual({
      headline: 'Felt great today!',
      zwiftMapLine: null,
    });
  });

  it('treats a sole 🗺️ paragraph as a Zwift map line, not a headline', () => {
    expect(splitExistingDescription('🗺️ Volcano Circuit in Watopia')).toEqual({
      headline: null,
      zwiftMapLine: '🗺️ Volcano Circuit in Watopia',
    });
  });

  it('separates headline from Zwift map line when both are present', () => {
    const input = 'Felt great today!\n\n🗺️ Volcano Circuit in Watopia';
    expect(splitExistingDescription(input)).toEqual({
      headline: 'Felt great today!',
      zwiftMapLine: '🗺️ Volcano Circuit in Watopia',
    });
  });

  it('strips stale emoji-prefixed stat lines when regenerating, capturing only the Zwift line from a multi-line emoji paragraph', () => {
    // This is the bug scenario: composeBlocks joins emoji stat lines with
    // single newlines, so on regenerate the previously-generated content
    // looks like ONE multi-line paragraph starting with 🗺️. The old
    // paragraph-startsWith implementation captured the whole thing as the
    // Zwift line, then duplicated everything on the next compose.
    const input =
      'Felt great today!\n\n🗺️ Volcano Circuit\n☁️ Old weather\n⚡️ Old power\n🔥 Old strain\n🎧 Old artists';
    expect(splitExistingDescription(input)).toEqual({
      headline: 'Felt great today!',
      zwiftMapLine: '🗺️ Volcano Circuit',
    });
  });

  it('strips LLM-picked weather emojis even when not in our enumerated set', () => {
    // Weather emojis come from an open set picked by the LLM. The
    // structural codepoint-based detector should still strip them.
    const input = 'Headline.\n\n🌧️ Heavy rain incoming\n⚡️ Power line';
    expect(splitExistingDescription(input)).toEqual({
      headline: 'Headline.',
      zwiftMapLine: null,
    });
  });

  it('preserves multi-paragraph user prose across the emoji block', () => {
    const input =
      'Felt strong today.\n\nKnee was a bit sore on the climbs.\n\n🗺️ Map\n⚡️ Power';
    expect(splitExistingDescription(input)).toEqual({
      headline: 'Felt strong today.\n\nKnee was a bit sore on the climbs.',
      zwiftMapLine: '🗺️ Map',
    });
  });

  it('collapses runs of more than two blank lines down to a single \\n\\n', () => {
    const input = 'Para 1.\n\n\n\nPara 2.';
    expect(splitExistingDescription(input)).toEqual({
      headline: 'Para 1.\n\nPara 2.',
      zwiftMapLine: null,
    });
  });
});

describe('composeBlocks', () => {
  it('separates headline from emoji blocks with a blank line, joins emoji blocks with single newlines', () => {
    const out = composeBlocks({
      headline: 'A nice ride.',
      weather: '🌤️ Sunny',
      power: '⚡️ NP 200 W',
    });
    expect(out).toBe('A nice ride.\n\n🌤️ Sunny\n⚡️ NP 200 W');
  });

  it('places the Zwift map line at the top of the emoji-block group', () => {
    const out = composeBlocks({
      headline: 'Endurance ride.',
      zwiftMapLine: '🗺️ Volcano Circuit in Watopia',
      power: '⚡️ NP 200 W',
    });
    expect(out).toBe('Endurance ride.\n\n🗺️ Volcano Circuit in Watopia\n⚡️ NP 200 W');
  });

  it('emits only the emoji section when no headline is present', () => {
    const out = composeBlocks({
      headline: null,
      weather: '🌤️ Sunny',
      power: '⚡️ NP 200 W',
      whoop: '🔥 Whoop strain 14.2',
    });
    expect(out).toBe('🌤️ Sunny\n⚡️ NP 200 W\n🔥 Whoop strain 14.2');
  });

  it('drops null/undefined/empty blocks', () => {
    const out = composeBlocks({
      headline: null,
      weather: undefined,
      power: '⚡️ NP 200 W',
    });
    expect(out).toBe('⚡️ NP 200 W');
  });

  it('emits just the headline when there are no emoji blocks', () => {
    expect(composeBlocks({ headline: 'Just a chill day.' })).toBe('Just a chill day.');
  });

  it('places the planned summary first in the emoji group with a 🗓️ prefix', () => {
    const out = composeBlocks({
      plannedSummary: '7×3-minute intervals at 5K pace with 3-minute recoveries',
      zwiftMapLine: '🗺️ Volcano Circuit',
      power: '⚡️ NP 200 W',
    });
    expect(out).toBe(
      '🗓️ 7×3-minute intervals at 5K pace with 3-minute recoveries\n🗺️ Volcano Circuit\n⚡️ NP 200 W'
    );
  });

  it('preserves the user headline above the emoji group when both are present', () => {
    const out = composeBlocks({
      headline: 'Felt great today.',
      plannedSummary: '2 hours of endurance at 70-75% FTP',
      power: '⚡️ NP 200 W',
    });
    expect(out).toBe(
      'Felt great today.\n\n🗓️ 2 hours of endurance at 70-75% FTP\n⚡️ NP 200 W'
    );
  });
});

// --------------------------------------------------------------------------
// Anthropic-backed helpers
// --------------------------------------------------------------------------

const mockParse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { parse: mockParse };
  }
  return { default: MockAnthropic };
});

vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({
  zodOutputFormat: (schema: unknown) => ({ schema }),
}));

// --------------------------------------------------------------------------
// generatePlannedSummary
// --------------------------------------------------------------------------

describe('generatePlannedSummary', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null without calling the API when description is empty/whitespace', async () => {
    expect(await generatePlannedSummary('', 'claude-sonnet-4-6')).toBeNull();
    expect(await generatePlannedSummary('   ', 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null without calling the API when no key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();
    expect(await generatePlannedSummary('7×3 min at 5k pace', 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('passes the description verbatim and returns the model summary', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: { planned_summary: '7×3-minute intervals at 5K pace with 3-minute recoveries' },
    });

    const result = await generatePlannedSummary(
      '7 reps × 3 min at 5k pace with 3-min jogs',
      'claude-sonnet-4-6'
    );

    expect(result).toBe('7×3-minute intervals at 5K pace with 3-minute recoveries');
    expect(mockParse).toHaveBeenCalledTimes(1);
    const call = mockParse.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.messages[0].content).toContain('7 reps × 3 min at 5k pace');
    // The planned-summary prompt is self-contained — no weather/music leakage.
    expect(call.system).not.toContain('weather_emoji');
    expect(call.system).not.toContain('top_artists');
    // Prompt instructs the model to emit no leading emoji (composer adds 🗓️):
    expect(call.system).toContain('emoji prefix is added by the caller');
  });

  it('returns null when the model declines to summarize', async () => {
    mockParse.mockResolvedValueOnce({ parsed_output: { planned_summary: null } });
    expect(await generatePlannedSummary('something', 'claude-sonnet-4-6')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// generateWeatherSentence
// --------------------------------------------------------------------------

describe('generateWeatherSentence', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null without calling the API when the activity is indoor', async () => {
    expect(await generateWeatherSentence('Sunny 20C', true, 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null without calling the API when the description is empty', async () => {
    expect(await generateWeatherSentence('', false, 'claude-sonnet-4-6')).toBeNull();
    expect(await generateWeatherSentence('   ', false, 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null when no API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();
    expect(await generateWeatherSentence('Sunny 20C', false, 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns the model rewrite on success', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        weather_emoji: '🌤️',
        weather_sentence: 'Mostly sunny with light W winds of 7–12 km/h, temps 10–14°C',
      },
    });

    const result = await generateWeatherSentence(
      'Mostly sunny, light W winds 7-12 km/h, 10-14C',
      false,
      'claude-sonnet-4-6'
    );

    expect(result).toEqual({
      emoji: '🌤️',
      sentence: 'Mostly sunny with light W winds of 7–12 km/h, temps 10–14°C',
    });
    const call = mockParse.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Mostly sunny, light W winds');
    // Self-contained prompt — no cross-leakage.
    expect(call.system).not.toContain('VO₂max');
    expect(call.system).not.toContain('top_artists');
  });

  it('returns null when the model returns only one of the two weather fields', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: { weather_emoji: '🌤️', weather_sentence: null },
    });
    expect(await generateWeatherSentence('Sunny', false, 'claude-sonnet-4-6')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// generateMusicSelection
// --------------------------------------------------------------------------

describe('generateMusicSelection', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null without calling the API when no songs are provided', async () => {
    expect(await generateMusicSelection([], 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null when every song is missing an artist or title', async () => {
    const songs: PlayedSong[] = [
      { name: '', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: 'X' },
      { name: 'Y', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: '' },
    ];
    expect(await generateMusicSelection(songs, 'claude-sonnet-4-6')).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null when no API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();
    expect(
      await generateMusicSelection([song('A')], 'claude-sonnet-4-6')
    ).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('passes scrobbles as plain `- Artist - Title` lines and never marks loved songs', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        top_artists: ['Radiohead', 'Foo Fighters'],
        remaining_artists: 3,
      },
    });

    const songs: PlayedSong[] = [
      song('Radiohead', { name: 'Karma Police' }),
      song('Foo Fighters', { name: 'The Pretender', loved: true }),
      song('The Foo Fighters', { name: 'Best of You' }),
      song('Tracy Chapman', { name: 'Fast Car' }),
      song('Johnny Cash', { name: 'Hurt' }),
    ];

    const result = await generateMusicSelection(songs, 'claude-sonnet-4-6');

    const content = mockParse.mock.calls[0][0].messages[0].content as string;
    expect(content).toContain('Played songs:');
    expect(content).toContain('- Radiohead - Karma Police');
    expect(content).toContain('- Foo Fighters - The Pretender');
    expect(content).toContain('- The Foo Fighters - Best of You');
    expect(content).toContain('- Tracy Chapman - Fast Car');
    expect(content).toContain('- Johnny Cash - Hurt');
    // Loved flag is not forwarded:
    expect(content).not.toContain('❤');
    expect(content).not.toContain('loved');
    // Self-contained prompt — no cross-leakage.
    expect(mockParse.mock.calls[0][0].system).not.toContain('VO₂max');
    expect(mockParse.mock.calls[0][0].system).not.toContain('weather_emoji');

    expect(result).toEqual({ top_artists: ['Radiohead', 'Foo Fighters'], remaining_artists: 3 });
  });

  it('drops scrobbles missing an artist or title', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: { top_artists: ['Radiohead'], remaining_artists: 0 },
    });

    const songs: PlayedSong[] = [
      song('Radiohead', { name: 'Karma Police' }),
      { name: '', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: 'X' },
      { name: 'Y', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: '' },
    ];

    await generateMusicSelection(songs, 'claude-sonnet-4-6');

    const content = mockParse.mock.calls[0][0].messages[0].content as string;
    expect(content).toContain('- Radiohead - Karma Police');
    expect(content).not.toMatch(/- X -/);
    expect(content).not.toMatch(/- - Y/);
  });

  it('returns null when the model returns an empty or null top_artists', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: { top_artists: null, remaining_artists: null },
    });
    expect(await generateMusicSelection([song('A')], 'claude-sonnet-4-6')).toBeNull();

    mockParse.mockResolvedValueOnce({
      parsed_output: { top_artists: [], remaining_artists: 0 },
    });
    expect(await generateMusicSelection([song('A')], 'claude-sonnet-4-6')).toBeNull();
  });

  it('defaults remaining_artists to 0 when the model omits it', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: { top_artists: ['A', 'B'], remaining_artists: null },
    });
    expect(await generateMusicSelection([song('A'), song('B')], 'claude-sonnet-4-6')).toEqual({
      top_artists: ['A', 'B'],
      remaining_artists: 0,
    });
  });
});

// --------------------------------------------------------------------------
// Orchestrator
// --------------------------------------------------------------------------

/**
 * Match each call to the right `parsed_output` by inspecting its user
 * message. Order-of-arrival isn't guaranteed across the three concurrent
 * `Promise.allSettled` calls, so we discriminate on the user-content prefix
 * — production strings, no test-only markers.
 */
function callKind(args: {
  messages?: Array<{ role: string; content: string }>;
}): 'planned' | 'weather' | 'music' | 'unknown' {
  const content = args.messages?.[0]?.content ?? '';
  if (content.startsWith('Planned workout description')) return 'planned';
  if (content.startsWith('Weather data:')) return 'weather';
  if (content.startsWith('Played songs:')) return 'music';
  return 'unknown';
}

function dispatchMockParse(byCall: {
  planned?: unknown;
  weather?: unknown;
  music?: unknown;
}): void {
  mockParse.mockImplementation((args) => {
    const kind = callKind(args);
    if (kind !== 'unknown' && byCall[kind] !== undefined) {
      return Promise.resolve(byCall[kind]);
    }
    return Promise.reject(new Error(`Unexpected LLM call: kind="${kind}"`));
  });
}

describe('generateActivityDescription (orchestrator)', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('preserves an existing user headline and emits a fresh planned-summary line below it', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '1-hour endurance ride at 65-75% FTP' } },
      weather: {
        parsed_output: {
          weather_emoji: '☁️',
          weather_sentence: 'Overcast with light NW winds, around 10°C',
        },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        description: 'Felt great today!',
        weather_description: 'Overcast, NW wind, 10C',
        is_indoor: false,
        average_power: '200 W',
        normalized_power: '210 W',
        intensity_factor: 0.71,
        tss: 98,
      }),
      whoop: { id: 'w1', strain_score: 14.2 },
      plannedSummary: { description: 'TR description for the planned-summary LLM call' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    // Planned + weather calls both fire (the existing user headline no
    // longer short-circuits anything):
    const kinds = mockParse.mock.calls.map((c) => callKind(c[0]));
    expect(kinds).toContain('planned');
    expect(kinds).toContain('weather');

    expect(description.startsWith('Felt great today!\n\n🗓️ 1-hour endurance ride at 65-75% FTP')).toBe(true);
    expect(description).toContain('☁️ Overcast with light NW winds');
    expect(description).toContain('⚡️ Avg 200 W · NP 210 W · IF 0.71 · TSS 98');
    expect(description).toContain('🔥 Whoop strain 14.2');
  });

  it('emits planned + music alongside an existing user headline, skipping the indoor weather call', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '90 minutes of endurance at 65-75% FTP' } },
      music: {
        parsed_output: {
          top_artists: ['Radiohead', 'Foo Fighters', 'Tracy Chapman'],
          remaining_artists: 4,
        },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        description: 'Felt great today!',
        is_indoor: true,
        played_songs: [song('Radiohead'), song('Foo Fighters', { loved: true })],
      }),
      whoop: null,
      plannedSummary: { description: 'Some TR description for the planned call' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    expect(description.startsWith('Felt great today!\n\n🗓️ 90 minutes of endurance at 65-75% FTP')).toBe(true);
    expect(description).toContain('🎧 Radiohead, Foo Fighters, Tracy Chapman, and 4 more');
    // Planned + music fire; weather does NOT (indoor short-circuit):
    const kinds = mockParse.mock.calls.map((c) => callKind(c[0]));
    expect(kinds).toContain('planned');
    expect(kinds).not.toContain('weather');
    expect(kinds).toContain('music');
  });

  it('puts the planned summary first in the emoji block, before the Zwift map line', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '1-hour endurance ride at 65-75% FTP' } },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        description: '🗺️ Volcano Circuit in Watopia',
        is_indoor: true,
        average_power: '200 W',
        tss: 50,
      }),
      whoop: { id: 'w1', strain_score: 11.0 },
      plannedSummary: { description: '65-75% FTP endurance, 1 hr' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    const lines = description.split('\n');
    // No top-level headline; planned-summary line leads the emoji block.
    expect(lines[0]).toBe('🗓️ 1-hour endurance ride at 65-75% FTP');
    expect(description).toContain('🗺️ Volcano Circuit in Watopia');
    // Order: planned summary → Zwift map → power.
    expect(description.indexOf('🗓️')).toBeLessThan(description.indexOf('🗺️'));
    expect(description.indexOf('🗺️')).toBeLessThan(description.indexOf('⚡️'));
  });

  it('composes a full description from all three LLM calls', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '1-hour endurance ride at 65-75% FTP' } },
      weather: {
        parsed_output: {
          weather_emoji: '🌤️',
          weather_sentence: 'Mostly sunny with light W winds of 7–12 km/h, temps 10–14°C',
        },
      },
      music: {
        parsed_output: {
          top_artists: ['Radiohead', 'Tracy Chapman', 'Foo Fighters'],
          remaining_artists: 2,
        },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        is_indoor: false,
        weather_description: 'Mostly sunny',
        average_power: '200 W',
        played_songs: [
          song('Radiohead'),
          song('Tracy Chapman'),
          song('Foo Fighters'),
          song('The Foo Fighters'),
          song('Johnny Cash'),
          song('Crowded House'),
        ],
      }),
      whoop: null,
      plannedSummary: { description: '65-75% FTP endurance, 1 hr' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    // No top-level headline; planned summary leads the emoji block.
    expect(description.startsWith('🗓️ 1-hour endurance ride at 65-75% FTP')).toBe(true);
    expect(description).toContain('🌤️ Mostly sunny with light W winds');
    expect(description).toContain('🎧 Radiohead, Tracy Chapman, Foo Fighters, and 2 more');
    // Planned summary precedes weather:
    expect(description.indexOf('🗓️')).toBeLessThan(description.indexOf('🌤️'));

    const kinds = mockParse.mock.calls.map((c) => callKind(c[0]));
    expect(kinds.filter((k) => k === 'planned')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'weather')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'music')).toHaveLength(1);
  });

  it('degrades gracefully when one of the three calls rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockParse.mockImplementation((args) => {
      const kind = callKind(args);
      if (kind === 'planned') return Promise.reject(new Error('planned boom'));
      if (kind === 'weather') {
        return Promise.resolve({
          parsed_output: {
            weather_emoji: '🌤️',
            weather_sentence: 'Mostly sunny',
          },
        });
      }
      if (kind === 'music') {
        return Promise.resolve({
          parsed_output: { top_artists: ['Radiohead'], remaining_artists: 0 },
        });
      }
      return Promise.reject(new Error('unexpected'));
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        weather_description: 'Sunny',
        is_indoor: false,
        played_songs: [song('Radiohead')],
      }),
      whoop: null,
      plannedSummary: { description: '1 hr endurance' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    // Planned summary failed → no 🗓️ line; weather + music survived:
    expect(description).not.toContain('🗓️');
    expect(description.startsWith('🌤️')).toBe(true);
    expect(description).toContain('🎧 Radiohead');

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[ActivityDescription] plannedSummary call failed:'),
      expect.any(Error)
    );
  });

  it('returns an empty string when nothing to say', async () => {
    const description = await generateActivityDescription({
      activity: workout({ activity_type: 'Running' }),
      whoop: null,
      plannedSummary: null,
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });
    expect(description).toBe('');
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('falls back to a random artist pick when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        is_indoor: true,
        average_power: '200 W',
        played_songs: [
          song('Radiohead'),
          song('Foo Fighters'),
          song('Tracy Chapman'),
          song('Johnny Cash'),
          song('Crowded House'),
          song('Tears for Fears'),
          song('Beyoncé'),
        ],
      }),
      whoop: null,
      plannedSummary: { description: 'Some plan we cannot summarize without a key' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    expect(mockParse).not.toHaveBeenCalled();

    const musicLine = description.split('\n').find((line) => line.startsWith('🎧 '));
    expect(musicLine).toBeDefined();
    expect(musicLine).toMatch(/, and 2 more$/);
    const names = musicLine!.replace(/^🎧 /, '').replace(/, and 2 more$/, '').split(', ');
    expect(names).toHaveLength(5);
    for (const name of names) {
      expect([
        'Radiohead',
        'Foo Fighters',
        'Tracy Chapman',
        'Johnny Cash',
        'Crowded House',
        'Tears for Fears',
        'Beyoncé',
      ]).toContain(name);
    }
    expect(new Set(names).size).toBe(5);
  });

  it('does not duplicate emoji stat lines when regenerating, including the planned-summary line', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '1-hour endurance ride at 65-75% FTP' } },
      weather: {
        parsed_output: {
          weather_emoji: '☁️',
          weather_sentence: 'Overcast with light NW winds, around 10°C',
        },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        // Looks like a previously-composed description: user headline +
        // multi-line emoji-block paragraph that includes a stale planned-
        // summary line. All emoji-prefixed lines should be stripped and
        // replaced; only the user headline is preserved.
        description:
          'User wrote this.\n\n🗓️ Old plan summary\n🗺️ Volcano Circuit\n☁️ Old weather\n⚡️ Old power\n🔥 Old strain',
        is_indoor: false,
        weather_description: 'Overcast, 10C',
        average_power: '200 W',
        normalized_power: '210 W',
        intensity_factor: 0.71,
        tss: 98,
      }),
      whoop: { id: 'w1', strain_score: 14.2 },
      plannedSummary: { description: '65-75% FTP endurance, 1 hr' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    expect(description.startsWith('User wrote this.')).toBe(true);
    expect(description).toContain('🗺️ Volcano Circuit');
    // Each emoji prefix appears exactly once — no duplicates:
    expect(description.match(/🗓️/g)?.length ?? 0).toBe(1);
    expect(description.match(/⚡️/g)?.length ?? 0).toBe(1);
    expect(description.match(/🔥/g)?.length ?? 0).toBe(1);
    expect(description.match(/☁️/g)?.length ?? 0).toBe(1);
    // The new lines are the fresh ones, not the stale ones:
    expect(description).toContain('🗓️ 1-hour endurance ride at 65-75% FTP');
    expect(description).toContain('⚡️ Avg 200 W · NP 210 W · IF 0.71 · TSS 98');
    expect(description).toContain('🔥 Whoop strain 14.2');
    expect(description).toContain('☁️ Overcast with light NW winds');
    expect(description).not.toContain('Old plan summary');
    expect(description).not.toContain('Old weather');
    expect(description).not.toContain('Old power');
    expect(description).not.toContain('Old strain');
  });

  it('preserves multi-paragraph user prose as the headline on regenerate, alongside a fresh planned-summary line', async () => {
    dispatchMockParse({
      planned: { parsed_output: { planned_summary: '30 minutes of Z2 endurance' } },
      music: {
        parsed_output: { top_artists: ['Radiohead'], remaining_artists: 0 },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        description:
          'Felt strong today.\n\nKnee was a bit sore on the climbs.\n\n🗺️ Map\n⚡️ Old power',
        is_indoor: true,
        played_songs: [song('Radiohead')],
      }),
      whoop: null,
      plannedSummary: { description: 'Z2 endurance, 30 min' },
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    expect(description.startsWith('Felt strong today.\n\nKnee was a bit sore on the climbs.')).toBe(true);
    expect(description).toContain('🗓️ 30 minutes of Z2 endurance');
    expect(description).toContain('🗺️ Map');
    expect(description).toContain('🎧 Radiohead');
    // Planned summary call fires; weather doesn't (indoor):
    const kinds = mockParse.mock.calls.map((c) => callKind(c[0]));
    expect(kinds).toContain('planned');
    expect(kinds).not.toContain('weather');
  });

  it('falls back to a random artist pick when the music LLM call rejects with a key set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockParse.mockImplementation((args) => {
      const kind = callKind(args);
      if (kind === 'music') return Promise.reject(new Error('music boom'));
      return Promise.resolve({
        parsed_output: { planned_summary: null, weather_emoji: null, weather_sentence: null },
      });
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        is_indoor: true,
        played_songs: [
          song('Radiohead'),
          song('Foo Fighters'),
          song('Tracy Chapman'),
        ],
      }),
      whoop: null,
      plannedSummary: null,
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    const musicLine = description.split('\n').find((line) => line.startsWith('🎧 '));
    expect(musicLine).toBeDefined();
    const names = musicLine!.replace(/^🎧 /, '').split(', ');
    expect(new Set(names)).toEqual(new Set(['Radiohead', 'Foo Fighters', 'Tracy Chapman']));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[ActivityDescription] music call failed:'),
      expect.any(Error)
    );
  });

  it('falls back to a random artist pick when the music LLM returns an explicit null', async () => {
    dispatchMockParse({
      music: {
        parsed_output: { top_artists: null, remaining_artists: null },
      },
    });

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        is_indoor: true,
        played_songs: [song('Radiohead'), song('Foo Fighters')],
      }),
      whoop: null,
      plannedSummary: null,
      heatAdaptationScore: null,
      model: 'claude-sonnet-4-6',
    });

    const musicLine = description.split('\n').find((line) => line.startsWith('🎧 '));
    expect(musicLine).toBeDefined();
    const names = musicLine!.replace(/^🎧 /, '').split(', ');
    expect(new Set(names)).toEqual(new Set(['Radiohead', 'Foo Fighters']));
  });
});
