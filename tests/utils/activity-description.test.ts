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
  generateLlmFields,
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

function parsedOutput(overrides: {
  headline?: string | null;
  weather_emoji?: string | null;
  weather_sentence?: string | null;
  top_artists?: string[] | null;
  remaining_artists?: number | null;
} = {}) {
  return {
    parsed_output: {
      headline: null,
      weather_emoji: null,
      weather_sentence: null,
      top_artists: null,
      remaining_artists: null,
      ...overrides,
    },
  };
}

describe('generateLlmFields', () => {
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
    const result = await generateLlmFields(
      { plannedSummary: { description: 'Some plan' } },
      'claude-sonnet-4-6'
    );
    expect(result).toEqual({
      headline: null,
      weather_emoji: null,
      weather_sentence: null,
      top_artists: null,
      remaining_artists: null,
    });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('skips the API entirely when there is nothing to produce', async () => {
    const result = await generateLlmFields(
      { plannedSummary: null },
      'claude-sonnet-4-6'
    );
    expect(result.headline).toBeNull();
    expect(result.weather_sentence).toBeNull();
    expect(result.top_artists).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('passes the planned-workout description verbatim and returns the model summary', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({ headline: '7×3-minute intervals at 5k pace with 3-minute recoveries.' })
    );

    const result = await generateLlmFields(
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
    mockParse.mockResolvedValueOnce(parsedOutput());

    const result = await generateLlmFields(
      { plannedSummary: { description: '' } },
      'claude-sonnet-4-6'
    );

    // Empty description short-circuits before the API call:
    expect(result.headline).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('omits weather output when the activity is indoor and no headline is requested', async () => {
    await generateLlmFields(
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
    mockParse.mockResolvedValueOnce(
      parsedOutput({
        weather_emoji: '🌤️',
        weather_sentence: 'Mostly sunny with light W winds of 7–12 km/h, temps 10–14°C',
      })
    );

    const result = await generateLlmFields(
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

  it('skips the API when only an empty played-songs list is provided', async () => {
    await generateLlmFields(
      { plannedSummary: null, playedSongs: [] },
      'claude-sonnet-4-6'
    );

    expect(mockParse).not.toHaveBeenCalled();
  });

  it('tells the model that played songs are absent when none are provided', async () => {
    mockParse.mockResolvedValueOnce(parsedOutput({ headline: 'Some headline.' }));

    await generateLlmFields(
      { plannedSummary: { description: 'Easy hour' } },
      'claude-sonnet-4-6'
    );

    const call = mockParse.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Played songs: not provided');
  });

  it('passes scrobbles as plain `- Artist - Title` lines, never marking loved songs', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({ top_artists: ['Radiohead', 'Foo Fighters'], remaining_artists: 3 })
    );

    const songs: PlayedSong[] = [
      song('Radiohead', { name: 'Karma Police' }),
      song('Foo Fighters', { name: 'The Pretender', loved: true }),
      song('The Foo Fighters', { name: 'Best of You' }),
      song('Tracy Chapman', { name: 'Fast Car' }),
      song('Johnny Cash', { name: 'Hurt' }),
    ];

    const result = await generateLlmFields(
      { plannedSummary: null, playedSongs: songs },
      'claude-sonnet-4-6'
    );

    const content = mockParse.mock.calls[0][0].messages[0].content;
    expect(content).toContain('Played songs:');
    expect(content).toContain('- Radiohead - Karma Police');
    expect(content).toContain('- Foo Fighters - The Pretender');
    expect(content).toContain('- The Foo Fighters - Best of You');
    expect(content).toContain('- Tracy Chapman - Fast Car');
    expect(content).toContain('- Johnny Cash - Hurt');
    // Loved flag is not forwarded:
    expect(content).not.toContain('❤');
    expect(content).not.toContain('loved');

    expect(result.top_artists).toEqual(['Radiohead', 'Foo Fighters']);
    expect(result.remaining_artists).toBe(3);
  });

  it('drops scrobbles missing an artist or title', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({ top_artists: ['Radiohead'], remaining_artists: 0 })
    );

    const songs: PlayedSong[] = [
      song('Radiohead', { name: 'Karma Police' }),
      { name: '', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: 'X' },
      { name: 'Y', played_at: '2024-12-15T10:00:00Z', url: '', album: '', artist: '' },
    ];

    await generateLlmFields(
      { plannedSummary: null, playedSongs: songs },
      'claude-sonnet-4-6'
    );

    const content = mockParse.mock.calls[0][0].messages[0].content as string;
    expect(content).toContain('- Radiohead - Karma Police');
    expect(content).not.toMatch(/- X -/);
    expect(content).not.toMatch(/- - Y/);
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
    mockParse.mockResolvedValueOnce(
      parsedOutput({
        weather_emoji: '☁️',
        weather_sentence: 'Overcast with light NW winds, around 10°C',
      })
    );

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

  it('preserves an existing headline but still regenerates the music line via the LLM', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({
        top_artists: ['Radiohead', 'Foo Fighters', 'Tracy Chapman'],
        remaining_artists: 4,
      })
    );

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        description: 'Felt great today!',
        is_indoor: true,
        played_songs: [song('Radiohead'), song('Foo Fighters', { loved: true })],
      }),
      whoop: null,
      plannedSummary: { description: 'Some TR description we should ignore' },
      model: 'claude-sonnet-4-6',
    });

    expect(description.startsWith('Felt great today!')).toBe(true);
    expect(description).toContain('🎧 Radiohead, Foo Fighters, Tracy Chapman, and 4 more');
  });

  it('moves a Zwift map line out of the headline slot', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({ headline: '1-hour endurance ride at 65-75% FTP.' })
    );

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

  it('renders the music block from the LLM-picked artist list', async () => {
    mockParse.mockResolvedValueOnce(
      parsedOutput({
        headline: '1-hour endurance ride at 65-75% FTP.',
        top_artists: ['Radiohead', 'Tracy Chapman', 'Foo Fighters'],
        remaining_artists: 2,
      })
    );

    const description = await generateActivityDescription({
      activity: workout({
        activity_type: 'Cycling',
        is_indoor: true,
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
      model: 'claude-sonnet-4-6',
    });

    expect(description).toContain('🎧 Radiohead, Tracy Chapman, Foo Fighters, and 2 more');
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
});
