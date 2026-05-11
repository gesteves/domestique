import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NormalizedWorkout, PlayedSong, WhoopMatchedData } from '../../src/types/index.js';
import {
  buildPowerBlock,
  buildHeatBlock,
  buildWhoopBlock,
  buildWaterTempBlock,
  buildMusicBlock,
  pickTopArtists,
  splitExistingDescription,
  composeBlocks,
  generateHeadlineAndWeather,
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
  it('returns null when either HSI field is missing', () => {
    expect(buildHeatBlock(workout({ max_heat_strain_index: 2 }))).toBeNull();
    expect(buildHeatBlock(workout({ median_heat_strain_index: 1 }))).toBeNull();
  });

  it('renders both values rounded to one decimal', () => {
    const block = buildHeatBlock(
      workout({ max_heat_strain_index: 2.47, median_heat_strain_index: 1.71 })
    );
    expect(block).toBe('🌡️ Max HSI 2.5 · Median HSI 1.7');
  });

  it('is skipped for swimming activities', () => {
    expect(
      buildHeatBlock(
        workout({ activity_type: 'Swimming', max_heat_strain_index: 2, median_heat_strain_index: 1 })
      )
    ).toBeNull();
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

describe('pickTopArtists', () => {
  it('returns empty on empty input', () => {
    expect(pickTopArtists([])).toEqual({ top: [], remaining: 0 });
  });

  it('ranks by play count', () => {
    const songs = [
      song('A'), song('A'), song('A'),
      song('B'), song('B'),
      song('C'),
    ];
    const { top, remaining } = pickTopArtists(songs);
    expect(top).toEqual(['A', 'B', 'C']);
    expect(remaining).toBe(0);
  });

  it('weights notable (loved) tracks (+2 each)', () => {
    // X: 1 loved track, 1 play → notable=1, score = 2*1 + 1 = 3
    // Y: 2 distinct unloved tracks, 1 play each → notable=0, score = 0 + 2 = 2
    const songs = [
      song('X', { loved: true }),
      song('Y', { name: 'Y - track A' }),
      song('Y', { name: 'Y - track B' }),
    ];
    const { top } = pickTopArtists(songs);
    expect(top).toEqual(['X', 'Y']);
  });

  it('treats a repeated track as notable (love-equivalent)', () => {
    // A: 1 unique track played twice → notable=1 (repeated), score = 2 + 2 = 4
    // B: 2 distinct tracks played once each → notable=0, score = 0 + 2 = 2
    const songs = [
      song('A', { name: 'A - track 1' }),
      song('A', { name: 'A - track 1' }),
      song('B', { name: 'B - track 1' }),
      song('B', { name: 'B - track 2' }),
    ];
    const { top } = pickTopArtists(songs);
    expect(top).toEqual(['A', 'B']);
  });

  it('compounds the notable bonus across multiple notable tracks', () => {
    // A: 3 distinct tracks, all repeated → notable=3, plays=6, score = 6 + 6 = 12
    // B: 1 loved track played 5 times → notable=1, plays=5, score = 2 + 5 = 7
    const songs = [
      song('A', { name: 'A - 1' }), song('A', { name: 'A - 1' }),
      song('A', { name: 'A - 2' }), song('A', { name: 'A - 2' }),
      song('A', { name: 'A - 3' }), song('A', { name: 'A - 3' }),
      song('B', { loved: true }),
      song('B', { loved: true }),
      song('B', { loved: true }),
      song('B', { loved: true }),
      song('B', { loved: true }),
    ];
    const { top } = pickTopArtists(songs);
    expect(top).toEqual(['A', 'B']);
  });

  it('caps at 5 and reports remaining unique artists', () => {
    const songs = [
      song('A'), song('A'), song('A'), song('A'),
      song('B'), song('B'), song('B'),
      song('C'), song('C'),
      song('D'), song('D'),
      song('E'),
      song('F'),
      song('G'),
      song('H'),
    ];
    const { top, remaining } = pickTopArtists(songs);
    expect(top).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(remaining).toBe(3);
  });

  it('breaks score/plays ties chronologically by first play (earliest first)', () => {
    // Both score=1, plays=1. Bee was scrobbled first → wins the tiebreak.
    const songs = [
      song('Bee', { playedAt: '2024-12-15T10:00:00Z' }),
      song('Alpha', { playedAt: '2024-12-15T11:00:00Z' }),
    ];
    const { top } = pickTopArtists(songs);
    expect(top).toEqual(['Bee', 'Alpha']);
  });

  it('uses the earliest scrobble across an artist for the chronological tiebreak', () => {
    // Both end up at score=2, plays=2. Z's first play (10:00) precedes Y's
    // first play (10:30), so Z wins despite appearing later in the input.
    const songs = [
      song('Y', { name: 'Y - 1', playedAt: '2024-12-15T10:30:00Z' }),
      song('Z', { name: 'Z - 1', playedAt: '2024-12-15T10:00:00Z' }),
      song('Y', { name: 'Y - 2', playedAt: '2024-12-15T11:00:00Z' }),
      song('Z', { name: 'Z - 2', playedAt: '2024-12-15T11:30:00Z' }),
    ];
    const { top } = pickTopArtists(songs);
    expect(top).toEqual(['Z', 'Y']);
  });
});

describe('buildMusicBlock', () => {
  it('joins top artists with comma', () => {
    expect(buildMusicBlock([song('A'), song('B'), song('C')])).toBe('🎧 A, B, C');
  });

  it('appends "and N more" when over 5 unique artists', () => {
    const songs = [
      song('A'), song('A'),
      song('B'),
      song('C'),
      song('D'),
      song('E'),
      song('F'),
      song('G'),
    ];
    const block = buildMusicBlock(songs);
    expect(block).toBe('🎧 A, B, C, D, E, and 2 more');
  });

  it('returns null when no songs', () => {
    expect(buildMusicBlock([])).toBeNull();
    expect(buildMusicBlock(undefined)).toBeNull();
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

describe('generateHeadlineAndWeather', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns all-null when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetDescriptionClientForTesting();
    const result = await generateHeadlineAndWeather(
      { plannedSummary: { description: 'Some plan' } },
      'claude-sonnet-4-6'
    );
    expect(result).toEqual({
      headline: null,
      weather_emoji: null,
      weather_sentence: null,
    });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('skips the API entirely when there is nothing to produce', async () => {
    const result = await generateHeadlineAndWeather(
      { plannedSummary: null },
      'claude-sonnet-4-6'
    );
    expect(result.headline).toBeNull();
    expect(result.weather_sentence).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('passes the planned-workout description verbatim and returns the model summary', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        headline: '7×3-minute intervals at 5k pace with 3-minute recoveries.',
        weather_emoji: null,
        weather_sentence: null,
      },
    });

    const result = await generateHeadlineAndWeather(
      { plannedSummary: { description: '7 reps × 3 min at 5k pace with 3-min jogs' } },
      'claude-sonnet-4-6'
    );

    expect(result.headline).toBe('7×3-minute intervals at 5k pace with 3-minute recoveries.');
    expect(mockParse).toHaveBeenCalledTimes(1);
    const call = mockParse.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.messages[0].content).toContain('7 reps × 3 min at 5k pace');
    // No multi-candidate phrasing in the new prompt:
    expect(call.messages[0].content).not.toContain('candidates');
  });

  it('returns null when the model declines to summarize a sparse description', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        headline: null,
        weather_emoji: null,
        weather_sentence: null,
      },
    });

    const result = await generateHeadlineAndWeather(
      { plannedSummary: { description: '' } },
      'claude-sonnet-4-6'
    );

    // Empty description short-circuits before the API call:
    expect(result.headline).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('omits weather output when the activity is indoor and no headline is requested', async () => {
    await generateHeadlineAndWeather(
      {
        plannedSummary: null,
        weatherDescription: 'Sunny 20C',
        isIndoor: true,
      },
      'claude-sonnet-4-6'
    );

    expect(mockParse).not.toHaveBeenCalled();
  });

  it('asks for a weather rewrite when weather is present and the activity is outdoor', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        headline: null,
        weather_emoji: '🌤️',
        weather_sentence: 'Mostly sunny with light W winds of 7–12 km/h, temps 10–14°C',
      },
    });

    const result = await generateHeadlineAndWeather(
      {
        plannedSummary: null,
        weatherDescription: 'Mostly sunny, light W winds 7-12 km/h, 10-14C',
        isIndoor: false,
      },
      'claude-sonnet-4-6'
    );

    expect(result.weather_emoji).toBe('🌤️');
    expect(result.weather_sentence).toContain('Mostly sunny');
    const call = mockParse.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Mostly sunny, light W winds');
  });
});

describe('generateActivityDescription (orchestrator)', () => {
  beforeEach(() => {
    mockParse.mockReset();
    _resetDescriptionClientForTesting();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('preserves an existing headline verbatim and skips the LLM headline path', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        headline: null, // we shouldn't have asked for one
        weather_emoji: '☁️',
        weather_sentence: 'Overcast with light NW winds, around 10°C',
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
      plannedSummary: { description: 'Some TR description we should ignore' },
      model: 'claude-sonnet-4-6',
    });

    // The LLM call still happens (for weather), but we asked for no headline:
    const call = mockParse.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Planned workout description: not provided');
    expect(call.messages[0].content).not.toContain('Some TR description we should ignore');

    expect(description.startsWith('Felt great today!')).toBe(true);
    expect(description).toContain('☁️ Overcast with light NW winds');
    expect(description).toContain('⚡️ Avg 200 W · NP 210 W · IF 0.71 · TSS 98');
    expect(description).toContain('🔥 Whoop strain 14.2');
  });

  it('moves a Zwift map line out of the headline slot', async () => {
    mockParse.mockResolvedValueOnce({
      parsed_output: {
        headline: '1-hour endurance ride at 65-75% FTP.',
        weather_emoji: null,
        weather_sentence: null,
      },
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
      model: 'claude-sonnet-4-6',
    });

    const lines = description.split('\n');
    expect(lines[0]).toBe('1-hour endurance ride at 65-75% FTP.');
    expect(description).toContain('🗺️ Volcano Circuit in Watopia');
    // Zwift line precedes the power line:
    expect(description.indexOf('🗺️')).toBeLessThan(description.indexOf('⚡️'));
  });

  it('returns an empty string when nothing to say', async () => {
    const description = await generateActivityDescription({
      activity: workout({ activity_type: 'Running' }),
      whoop: null,
      plannedSummary: null,
      model: 'claude-sonnet-4-6',
    });
    expect(description).toBe('');
    expect(mockParse).not.toHaveBeenCalled();
  });
});
