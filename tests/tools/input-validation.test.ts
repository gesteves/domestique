import { describe, it, expect, vi } from 'vitest';
import type { z } from 'zod';
import { ToolRegistry } from '../../src/tools/index.js';

vi.mock('../../src/clients/intervals.js', () => ({
  IntervalsClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

function captureInputSchemas(): Map<string, z.ZodType> {
  const schemas = new Map<string, z.ZodType>();
  const server = {
    registerTool: vi.fn((name: string, config: { inputSchema: z.ZodType }) => {
      schemas.set(name, config.inputSchema);
    }),
  };
  const registry = new ToolRegistry({ intervals: { apiKey: 'k', athleteId: 'i1' } });
  registry.registerTools(server as unknown as Parameters<typeof registry.registerTools>[0]);
  return schemas;
}

describe('ID inputs that end up in Intervals.icu URL paths', () => {
  const schemas = captureInputSchemas();

  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['get_workout_details', 'activity_id', {}],
    ['update_activity', 'activity_id', { name: 'x' }],
    ['set_workout_intervals', 'activity_id', { intervals: [] }],
    ['delete_workout', 'event_id', {}],
    ['update_workout', 'event_id', {}],
    ['update_annotation', 'event_id', {}],
    ['delete_annotation', 'event_id', {}],
  ];

  it.each(cases)('%s rejects a path-traversal %s', (tool, field, extra) => {
    const schema = schemas.get(tool)!;
    expect(schema).toBeDefined();
    for (const bad of ['../athlete/i123', 'i1?x=1', 'i1#frag', '1/2', '']) {
      expect(schema.safeParse({ ...extra, [field]: bad }).success, `${tool} accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it.each(cases)('%s accepts a normal %s', (tool, field, extra) => {
    const schema = schemas.get(tool)!;
    const id = field === 'activity_id' ? 'i111325719' : '98765432';
    const result = schema.safeParse({ ...extra, [field]: id });
    // Only assert the ID itself isn't what fails validation.
    const idIssues = result.success ? [] : result.error.issues.filter((i) => i.path[0] === field);
    expect(idIssues).toEqual([]);
  });
});
