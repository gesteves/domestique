import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools updateHeatAdaptationScore', () => {
  let tools: PlanningTools;
  let mockIntervalsClient: IntervalsClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/Denver');
    vi.mocked(mockIntervalsClient.updateWellness).mockResolvedValue({ id: '2026-05-07' } as never);

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults date to today in the athlete timezone when omitted', async () => {
    const result = await tools.updateHeatAdaptationScore({ score: 75 });

    expect(result.date).toBe('2026-05-07');
    expect(result.heat_adaptation_score).toBe('75%');
    expect(mockIntervalsClient.updateWellness).toHaveBeenCalledWith('2026-05-07', {
      CoreHeatAdaptationScore: 75,
    });
  });

  it('passes through an explicit ISO date', async () => {
    const result = await tools.updateHeatAdaptationScore({
      score: 60,
      date: '2026-05-04',
    });

    expect(result.date).toBe('2026-05-04');
    expect(result.heat_adaptation_score).toBe('60%');
    expect(mockIntervalsClient.updateWellness).toHaveBeenCalledWith('2026-05-04', {
      CoreHeatAdaptationScore: 60,
    });
  });

  it('parses natural-language relative dates against athlete timezone', async () => {
    const result = await tools.updateHeatAdaptationScore({
      score: 80,
      date: 'yesterday',
    });

    expect(result.date).toBe('2026-05-06');
    expect(mockIntervalsClient.updateWellness).toHaveBeenCalledWith('2026-05-06', {
      CoreHeatAdaptationScore: 80,
    });
  });

  it('maps score to the CoreHeatAdaptationScore PascalCase API key', async () => {
    await tools.updateHeatAdaptationScore({ score: 42, date: '2026-05-07' });

    const [, body] = vi.mocked(mockIntervalsClient.updateWellness).mock.calls[0];
    expect(Object.keys(body)).toEqual(['CoreHeatAdaptationScore']);
    expect(body.CoreHeatAdaptationScore).toBe(42);
  });

  it('formats the response score as a percent string', async () => {
    const result = await tools.updateHeatAdaptationScore({ score: 0, date: '2026-05-07' });

    expect(result.heat_adaptation_score).toBe('0%');
  });

  it('propagates upstream API errors', async () => {
    vi.mocked(mockIntervalsClient.updateWellness).mockRejectedValue(new Error('Wellness not found'));

    await expect(
      tools.updateHeatAdaptationScore({ score: 75, date: '2026-05-07' })
    ).rejects.toThrow('Wellness not found');
  });
});
