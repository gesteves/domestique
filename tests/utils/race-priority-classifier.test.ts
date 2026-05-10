import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_CLASSIFIER_MODEL } from '../../src/utils/classifier-model.js';

const mockParse = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { parse: mockParse };
      constructor(opts: unknown) {
        mockConstructor(opts);
      }
    },
  };
});

const mockRedisGetJson = vi.fn();
const mockRedisSetJson = vi.fn();

vi.mock('../../src/utils/redis.js', () => ({
  redisGetJson: (...args: unknown[]) => mockRedisGetJson(...args),
  redisSetJson: (...args: unknown[]) => mockRedisSetJson(...args),
}));

async function loadModule() {
  const mod = await import('../../src/utils/race-priority-classifier.js');
  mod._resetClassifierClientForTesting();
  return mod;
}

describe('classifyRacePriority', () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockConstructor.mockReset();
    mockRedisGetJson.mockReset();
    mockRedisSetJson.mockReset();
    mockRedisGetJson.mockResolvedValue(null);
    mockRedisSetJson.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_CLASSIFIER_MODEL;
  });

  it('returns null when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { classifyRacePriority } = await loadModule();

    const result = await classifyRacePriority({
      name: 'Escape from Alcatraz',
      description: 'A race',
    });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null when both name and description are empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { classifyRacePriority } = await loadModule();

    const result = await classifyRacePriority({ name: '   ', description: '' });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockRedisGetJson).not.toHaveBeenCalled();
  });

  it("returns 'A' when the model says priority is A and caches the verdict", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'A' } });
    const { classifyRacePriority, _CACHE_KEY_PREFIX_FOR_TESTING } = await loadModule();

    const result = await classifyRacePriority({
      name: 'Boulder 70.3',
      description: 'A race — peak event',
    });

    expect(result).toBe('A');
    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockRedisSetJson).toHaveBeenCalledTimes(1);
    const [cacheKey, cached, ttl] = mockRedisSetJson.mock.calls[0];
    expect(cacheKey.startsWith(_CACHE_KEY_PREFIX_FOR_TESTING)).toBe(true);
    expect(cacheKey).toMatch(/[0-9a-f]{64}$/);
    expect(cached).toEqual({ priority: 'A' });
    expect(ttl).toBe(60 * 60 * 24 * 30);
  });

  it("uses the configured classifier model with structured output and a no-hallucination system prompt", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'B' } });
    const { classifyRacePriority } = await loadModule();

    await classifyRacePriority({
      name: 'Some race',
      description: 'B race',
    });

    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe(DEFAULT_CLASSIFIER_MODEL);
    expect(callArgs.output_config?.format).toBeDefined();
    expect(callArgs.system).toMatch(/explicitly states the priority/i);
    expect(callArgs.system).toMatch(/do not guess/i);
  });

  it("maps the model's 'none' sentinel to null and emits priority undefined", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'none' } });
    const { classifyRacePriority } = await loadModule();

    const priority = await classifyRacePriority({
      name: 'Boulder 70.3',
      description: 'Triathlon in Boulder',
    });

    expect(priority).toBeNull();

    // Contract: when the helper returns null, callers build a Race without
    // setting priority. JSON.stringify must not include the field.
    type Race = { name: string; sport: string; priority?: 'A' | 'B' | 'C' };
    const race: Race = {
      name: 'Boulder 70.3',
      sport: 'Triathlon',
    };
    if (priority) {
      race.priority = priority;
    }
    const serialized = JSON.stringify(race);
    expect(serialized).not.toContain('"priority"');
  });

  it("caches the 'none' verdict so repeated lookups don't re-call the API", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'none' } });
    const { classifyRacePriority } = await loadModule();

    await classifyRacePriority({ name: 'X', description: 'no priority info here' });

    // 'none' must be persisted (not skipped) — otherwise we'd keep paying for
    // re-classification of races whose descriptions never get edited.
    expect(mockRedisSetJson).toHaveBeenCalledTimes(1);
    const [, cached] = mockRedisSetJson.mock.calls[0];
    expect(cached).toEqual({ priority: 'none' });
  });

  it("returns null on a cached 'none' without calling the API", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockRedisGetJson.mockResolvedValueOnce({ priority: 'none' });
    const { classifyRacePriority } = await loadModule();

    const result = await classifyRacePriority({ name: 'X', description: 'whatever' });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
  });

  it("returns the cached priority without invoking the API on a hit", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockRedisGetJson.mockResolvedValueOnce({ priority: 'A' });
    const { classifyRacePriority } = await loadModule();

    const result = await classifyRacePriority({ name: 'X', description: 'A race' });

    expect(result).toBe('A');
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
  });

  it('returns null and does not cache when the API call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { classifyRacePriority } = await loadModule();

    const result = await classifyRacePriority({ name: 'whatever' });

    expect(result).toBeNull();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('produces stable cache keys for the same name + description', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { priority: 'A' } });
    const { classifyRacePriority } = await loadModule();

    await classifyRacePriority({ name: 'Race day', description: 'A race' });
    await classifyRacePriority({ name: 'Race day', description: 'A race' });

    const first = mockRedisGetJson.mock.calls[0][0];
    const second = mockRedisGetJson.mock.calls[1][0];
    expect(first).toBe(second);
  });

  it('produces a different cache key when the description is edited (so user edits invalidate)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { priority: 'B' } });
    const { classifyRacePriority } = await loadModule();

    // First call: race has no priority text in the description.
    await classifyRacePriority({
      name: 'Boulder 70.3',
      description: 'Triathlon in Boulder',
    });
    // User goes back and edits the description to add the priority.
    await classifyRacePriority({
      name: 'Boulder 70.3',
      description: 'Triathlon in Boulder. B race.',
    });

    const firstKey = mockRedisGetJson.mock.calls[0][0];
    const secondKey = mockRedisGetJson.mock.calls[1][0];
    expect(firstKey).not.toBe(secondKey);

    // And both calls must hit the API (no shared cache entry).
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it('initializes the Anthropic client only once across calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { priority: 'A' } });
    const { classifyRacePriority } = await loadModule();

    await classifyRacePriority({ name: 'A' });
    await classifyRacePriority({ name: 'B' });

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockConstructor).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('uses ANTHROPIC_CLASSIFIER_MODEL when set, falling back to the default otherwise', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_CLASSIFIER_MODEL = 'claude-sonnet-4-6';
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'A' } });
    const { classifyRacePriority } = await loadModule();

    await classifyRacePriority({ name: 'Race', description: 'A race' });
    expect(mockParse.mock.calls[0][0].model).toBe('claude-sonnet-4-6');

    delete process.env.ANTHROPIC_CLASSIFIER_MODEL;
    mockParse.mockResolvedValueOnce({ parsed_output: { priority: 'B' } });
    await classifyRacePriority({ name: 'Other', description: 'B race' });
    expect(mockParse.mock.calls[1][0].model).toBe(DEFAULT_CLASSIFIER_MODEL);
  });
});
