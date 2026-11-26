import { describe, it, expect } from 'vitest';
import { paceCurveProgressHint, powerCurveProgressHint } from '../../src/utils/hints/fitness-hints.js';
import type { PaceCurvesResponse, PowerCurvesResponse } from '../../src/types/index.js';

function paceResponse(sport: string, change_percent: string, improved: boolean): PaceCurvesResponse {
  return {
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    sport,
    gap_adjusted: false,
    activity_count: 3,
    distances_analyzed: ['5km'],
    summary: {} as PaceCurvesResponse['summary'],
    comparison: {
      changes: [{ distance_label: '5km', current_seconds: 1200, previous_seconds: 1250, change_seconds: -50, change_percent, improved }],
    },
  } as unknown as PaceCurvesResponse;
}

describe('paceCurveProgressHint', () => {
  it('fires for a >=3% faster time (negative change_percent)', () => {
    const hint = paceCurveProgressHint(paceResponse('running', '-4.0%', true));
    expect(hint).toContain("sports=['running']");
  });

  it('names swimming for swim curves', () => {
    const hint = paceCurveProgressHint(paceResponse('swimming', '-5.0%', true));
    expect(hint).toContain("sports=['swimming']");
  });

  it('does not fire for a small improvement', () => {
    expect(paceCurveProgressHint(paceResponse('running', '-1.0%', true))).toBeUndefined();
  });

  it('does not fire for a slower time', () => {
    expect(paceCurveProgressHint(paceResponse('running', '5.0%', false))).toBeUndefined();
  });
});

describe('powerCurveProgressHint', () => {
  it('uses the real get_sports_settings parameter name', () => {
    const data = {
      comparison: { changes: [{ improved: true, change_percent: '+5.0%' }] },
    } as unknown as PowerCurvesResponse;
    expect(powerCurveProgressHint(data)).toContain("sports=['cycling']");
  });
});
