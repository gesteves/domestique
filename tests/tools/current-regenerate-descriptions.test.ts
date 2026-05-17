import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/description-regen.js', () => ({
  regenerateDayDescriptions: vi
    .fn()
    .mockResolvedValue({ date: '2024-12-15', regenerated: ['a1'], skipped: ['a2'] }),
}));

import { CurrentTools } from '../../src/tools/current.js';
import { regenerateDayDescriptions } from '../../src/services/description-regen.js';
import type { IntervalsClient } from '../../src/clients/intervals.js';
import type { WhoopClient } from '../../src/clients/whoop.js';
import type { TrainerRoadClient } from '../../src/clients/trainerroad.js';

const regenMock = regenerateDayDescriptions as unknown as ReturnType<typeof vi.fn>;

function makeTools() {
  const intervals = {} as unknown as IntervalsClient;
  const whoop = { tag: 'whoop' } as unknown as WhoopClient;
  const trainerroad = { tag: 'tr' } as unknown as TrainerRoadClient;
  const tools = new CurrentTools(
    intervals,
    whoop,
    trainerroad,
    null,
    null,
    null,
    null,
    null,
    null
  );
  return { tools, intervals, whoop, trainerroad };
}

describe('CurrentTools.regenerateDescriptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a null date through and returns the structured result', async () => {
    const { tools, intervals, whoop, trainerroad } = makeTools();
    const result = await tools.regenerateDescriptions();
    expect(result).toEqual({ date: '2024-12-15', regenerated: ['a1'], skipped: ['a2'] });
    expect(regenMock).toHaveBeenCalledTimes(1);
    expect(regenMock.mock.calls[0][0]).toBeNull();
    expect(regenMock.mock.calls[0][1]).toEqual({ intervals, whoop, trainerroad });
  });

  it('passes a valid YYYY-MM-DD date through', async () => {
    const { tools } = makeTools();
    await tools.regenerateDescriptions({ date: '2024-12-15' });
    expect(regenMock.mock.calls[0][0]).toBe('2024-12-15');
  });

  it('rejects an impossible date without calling the service', async () => {
    const { tools } = makeTools();
    await expect(tools.regenerateDescriptions({ date: '2024-13-40' })).rejects.toThrow(
      /valid YYYY-MM-DD/i
    );
    expect(regenMock).not.toHaveBeenCalled();
  });
});
