import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_WORKOUT_MODEL } from '../../src/utils/classifier-model.js';

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

async function loadModule() {
  const mod = await import('../../src/utils/workout-generator.js');
  mod._resetWorkoutGeneratorClientForTesting();
  return mod;
}

describe('generateWorkoutDoc', () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockConstructor.mockReset();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_WORKOUT_MODEL;
  });

  it('throws a clear error when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { generateWorkoutDoc } = await loadModule();

    await expect(
      generateWorkoutDoc({ sport: 'cycling', structure: 'easy spin' })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('throws when `structure` is empty or whitespace', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { generateWorkoutDoc } = await loadModule();

    await expect(
      generateWorkoutDoc({ sport: 'cycling', structure: '   ' })
    ).rejects.toThrow(/`structure` is empty/);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns the trimmed workout_doc from the API response', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({
      parsed_output: { workout_doc: '  Warmup\n- 10m 60%\n  ' },
    });
    const { generateWorkoutDoc } = await loadModule();

    const result = await generateWorkoutDoc({
      sport: 'cycling',
      structure: '10 min warmup at 60% FTP',
    });

    expect(result).toBe('Warmup\n- 10m 60%');
    expect(mockParse).toHaveBeenCalledTimes(1);
    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe(DEFAULT_WORKOUT_MODEL);
    expect(callArgs.messages[0].content).toBe('10 min warmup at 60% FTP');
    expect(callArgs.output_config?.format).toBeDefined();
  });

  it('selects the cycling system prompt for cycling', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { workout_doc: 'x' } });
    const { generateWorkoutDoc } = await loadModule();

    await generateWorkoutDoc({ sport: 'cycling', structure: 'go' });

    const system = mockParse.mock.calls[0][0].system as string;
    expect(system).toMatch(/Cycling Workout Syntax/i);
    expect(system).not.toMatch(/Running Workout Syntax/i);
  });

  it('selects the running system prompt for running', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { workout_doc: 'x' } });
    const { generateWorkoutDoc } = await loadModule();

    await generateWorkoutDoc({ sport: 'running', structure: 'go' });

    const system = mockParse.mock.calls[0][0].system as string;
    expect(system).toMatch(/Running Workout Syntax/i);
    expect(system).not.toMatch(/Cycling Workout Syntax/i);
  });

  it('throws when parsed_output is missing workout_doc', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValueOnce({ parsed_output: { workout_doc: '   ' } });
    const { generateWorkoutDoc } = await loadModule();

    await expect(
      generateWorkoutDoc({ sport: 'cycling', structure: 'easy ride' })
    ).rejects.toThrow(/empty workout_doc/);
  });

  it('propagates transport errors', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockRejectedValueOnce(new Error('boom'));
    const { generateWorkoutDoc } = await loadModule();

    await expect(
      generateWorkoutDoc({ sport: 'cycling', structure: 'easy ride' })
    ).rejects.toThrow('boom');
  });

  it('reuses the Anthropic client across calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    mockParse.mockResolvedValue({ parsed_output: { workout_doc: 'x' } });
    const { generateWorkoutDoc } = await loadModule();

    await generateWorkoutDoc({ sport: 'cycling', structure: 'a' });
    await generateWorkoutDoc({ sport: 'running', structure: 'b' });

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockConstructor).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('uses ANTHROPIC_WORKOUT_MODEL when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_WORKOUT_MODEL = 'claude-haiku-4-5';
    mockParse.mockResolvedValueOnce({ parsed_output: { workout_doc: 'x' } });
    const { generateWorkoutDoc } = await loadModule();

    await generateWorkoutDoc({ sport: 'cycling', structure: 'a' });

    expect(mockParse.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });
});
