import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  const mod = await import('../../src/utils/annotation-categorizer.js');
  mod._resetCategorizerClientForTesting();
  return mod;
}

describe('categorizeAnnotation', () => {
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
  });

  it('returns null when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: 'Cold', description: 'sick today' });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns null when both name and description are empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: '   ', description: '' });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockRedisGetJson).not.toHaveBeenCalled();
  });

  it('returns the parsed category when the API call succeeds and caches the result', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { category: 'Sick' } });
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: 'Cold', description: 'feeling unwell' });

    expect(result).toBe('Sick');
    expect(mockParse).toHaveBeenCalledTimes(1);
    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.messages[0].content).toContain('Cold');
    expect(callArgs.messages[0].content).toContain('feeling unwell');
    expect(callArgs.output_config?.format).toBeDefined();

    expect(mockRedisSetJson).toHaveBeenCalledTimes(1);
    const [cacheKey, cached, ttl] = mockRedisSetJson.mock.calls[0];
    expect(cacheKey).toMatch(/^domestique:annotation-category:v1:[0-9a-f]{64}$/);
    expect(cached).toEqual({ category: 'Sick' });
    expect(ttl).toBe(60 * 60 * 24 * 30);
  });

  it('returns the cached category without invoking the API on a hit', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockRedisGetJson.mockResolvedValueOnce({ category: 'Holiday' });
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: 'Vacation', description: 'beach trip' });

    expect(result).toBe('Holiday');
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
  });

  it('returns null and does not cache when the API call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: 'Whatever' });

    expect(result).toBeNull();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns null when parsed_output is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: null });
    const { categorizeAnnotation } = await loadModule();

    const result = await categorizeAnnotation({ name: 'Conference' });

    expect(result).toBeNull();
    expect(mockRedisSetJson).not.toHaveBeenCalled();
  });

  it('initializes the Anthropic client only once across calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { category: 'Note' } });
    const { categorizeAnnotation } = await loadModule();

    await categorizeAnnotation({ name: 'A' });
    await categorizeAnnotation({ name: 'B' });

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockConstructor).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('produces stable cache keys for the same inputs', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { category: 'Note' } });
    const { categorizeAnnotation } = await loadModule();

    await categorizeAnnotation({ name: 'Race day', description: 'A race' });
    await categorizeAnnotation({ name: 'Race day', description: 'A race' });

    const firstKey = mockRedisGetJson.mock.calls[0][0];
    const secondKey = mockRedisGetJson.mock.calls[1][0];
    expect(firstKey).toBe(secondKey);
  });
});
