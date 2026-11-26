import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import * as schemas from '../../src/schemas/index.js';
import { ToolRegistry } from '../../src/tools/index.js';

/**
 * `buildToolResponse` strips every null from structuredContent before the SDK
 * validates it against the tool's outputSchema. A field declared
 * `.nullable()` without `.optional()` therefore fails validation whenever the
 * handler returns null for it — the tool call comes back as an
 * "Output validation error". These tests guard that class of bug.
 */

type AnyZod = z.ZodType & { _zod: { def: Record<string, unknown> } };

function collectNullableRequired(schema: AnyZod, path: string, out: string[]): void {
  const def = schema._zod.def;
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, AnyZod>;
      for (const [key, field] of Object.entries(shape)) {
        const fieldPath = path ? `${path}.${key}` : key;
        if (field.safeParse(null).success && !field.safeParse(undefined).success) {
          out.push(fieldPath);
        }
        collectNullableRequired(field, fieldPath, out);
      }
      break;
    }
    case 'array':
      collectNullableRequired(def.element as AnyZod, `${path}[]`, out);
      break;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
      collectNullableRequired(def.innerType as AnyZod, path, out);
      break;
    case 'union':
      for (const option of def.options as AnyZod[]) collectNullableRequired(option, path, out);
      break;
    case 'record':
      collectNullableRequired(def.valueType as AnyZod, `${path}{}`, out);
      break;
    default:
      break;
  }
}

describe('output schemas', () => {
  const outputSchemas = Object.entries(schemas).filter(([name]) => name.endsWith('OutputSchema'));

  it('finds the output schemas to check', () => {
    expect(outputSchemas.length).toBeGreaterThan(10);
  });

  it.each(outputSchemas)('%s has no nullable-but-required fields (nulls are stripped before validation)', (_name, shape) => {
    const offenders: string[] = [];
    collectNullableRequired(z.object(shape as z.ZodRawShape) as unknown as AnyZod, '', offenders);
    expect(offenders).toEqual([]);
  });
});

vi.mock('../../src/clients/intervals.js', () => ({
  IntervalsClient: vi.fn().mockImplementation(function () {
    return {
      getAthleteTimezone: vi.fn().mockResolvedValue('America/Denver'),
      getUnitPreferences: vi.fn().mockResolvedValue({
        system: 'metric', weight: 'kg', temperature: 'celsius', wind: 'kmh', precipitation: 'mm', height: 'cm',
      }),
      getPowerCurves: vi.fn().mockResolvedValue({ durations: [300], activities: [] }),
      getHRCurves: vi.fn().mockResolvedValue({ durations: [300], activities: [] }),
      getPaceCurves: vi.fn().mockResolvedValue({ distances: [5000], activities: [] }),
      getAthleteProfile: vi.fn().mockResolvedValue({ id: 'i1' }),
    };
  }),
}));

describe('curve tools without a comparison range', () => {
  let handlers: Map<string, { handler: (args: unknown) => Promise<{ isError?: boolean; structuredContent: unknown }>; outputSchema: z.ZodType }>;

  beforeEach(() => {
    handlers = new Map();
    const server = {
      registerTool: vi.fn((name: string, config: { outputSchema: z.ZodType }, handler: never) => {
        handlers.set(name, { handler, outputSchema: config.outputSchema });
      }),
    };
    const registry = new ToolRegistry({ intervals: { apiKey: 'k', athleteId: 'i1' } });
    registry.registerTools(server as unknown as Parameters<typeof registry.registerTools>[0]);
  });

  it.each([
    ['get_power_curve', { oldest: '2026-01-01', newest: '2026-01-31' }],
    ['get_hr_curve', { oldest: '2026-01-01', newest: '2026-01-31' }],
    ['get_pace_curve', { oldest: '2026-01-01', newest: '2026-01-31', sport: 'running' }],
  ])('%s returns structuredContent that validates against its outputSchema', async (name, args) => {
    const tool = handlers.get(name)!;
    const result = await tool.handler(args);
    expect(result.isError).toBeUndefined();
    const parsed = tool.outputSchema.safeParse(result.structuredContent);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});
