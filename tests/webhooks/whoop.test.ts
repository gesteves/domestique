import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createHmac } from 'crypto';
import {
  createWhoopWebhookHandler,
  dispatchWhoopWebhook,
  verifyWhoopSignature,
  type WhoopWebhookPayload,
  type WhoopWebhookDeps,
} from '../../src/webhooks/whoop.js';

const CLIENT_SECRET = 'test-whoop-client-secret';
const ATHLETE_USER_ID = 10129;

function sign(body: string, timestamp: string, secret = CLIENT_SECRET): string {
  return createHmac('sha256', secret).update(timestamp).update(body).digest('base64');
}

interface FakeWhoop {
  getUserId: ReturnType<typeof vi.fn>;
  getWorkoutById: ReturnType<typeof vi.fn>;
  getStrainData: ReturnType<typeof vi.fn>;
}

interface FakeIntervals {
  getAthleteTimezone: ReturnType<typeof vi.fn>;
  getActivities: ReturnType<typeof vi.fn>;
  updateActivity: ReturnType<typeof vi.fn>;
  updateWellness: ReturnType<typeof vi.fn>;
}

function makeFakes(): { whoop: FakeWhoop; intervals: FakeIntervals } {
  return {
    whoop: {
      getUserId: vi.fn().mockResolvedValue(ATHLETE_USER_ID),
      getWorkoutById: vi.fn(),
      getStrainData: vi.fn().mockResolvedValue([]),
    },
    intervals: {
      getAthleteTimezone: vi.fn().mockResolvedValue('UTC'),
      getActivities: vi.fn().mockResolvedValue([]),
      updateActivity: vi.fn().mockResolvedValue(undefined),
      updateWellness: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeApp(deps: WhoopWebhookDeps): express.Express {
  const app = express();
  app.post(
    '/webhooks/whoop',
    express.raw({ type: 'application/json' }),
    createWhoopWebhookHandler(deps)
  );
  return app;
}

async function postWebhook(
  app: express.Express,
  payload: WhoopWebhookPayload,
  opts: { secret?: string; timestamp?: string; signature?: string; rawBody?: string } = {}
): Promise<{ status: number; body: any }> {
  const rawBody = opts.rawBody ?? JSON.stringify(payload);
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = opts.signature ?? sign(rawBody, timestamp, opts.secret ?? CLIENT_SECRET);

  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as { port: number }).port;
        const res = await fetch(`http://127.0.0.1:${port}/webhooks/whoop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WHOOP-Signature': signature,
            'X-WHOOP-Signature-Timestamp': timestamp,
          },
          body: rawBody,
        });
        const body = await res.json().catch(() => ({}));
        server.close();
        resolve({ status: res.status, body });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

/** Wait until all pending fire-and-forget work scheduled via the handler is done. */
async function flushAsync(): Promise<void> {
  // Two microtask rounds + a setImmediate are enough to drain awaited Promise.then chains.
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}

describe('verifyWhoopSignature', () => {
  it('accepts a correctly-signed body', () => {
    const body = Buffer.from('{"hello":"world"}');
    const ts = '1700000000000';
    const sig = sign(body.toString(), ts);
    expect(verifyWhoopSignature(body, ts, sig, CLIENT_SECRET)).toBe(true);
  });

  it('rejects an altered body', () => {
    const body = Buffer.from('{"hello":"world"}');
    const ts = '1700000000000';
    const sig = sign(body.toString(), ts);
    const tampered = Buffer.from('{"hello":"WORLD"}');
    expect(verifyWhoopSignature(tampered, ts, sig, CLIENT_SECRET)).toBe(false);
  });

  it('rejects when the signing secret differs', () => {
    const body = Buffer.from('{"hello":"world"}');
    const ts = '1700000000000';
    const sig = sign(body.toString(), ts, 'not-the-secret');
    expect(verifyWhoopSignature(body, ts, sig, CLIENT_SECRET)).toBe(false);
  });
});

describe('Whoop webhook handler', () => {
  let fakes: ReturnType<typeof makeFakes>;
  let app: express.Express;

  beforeEach(() => {
    fakes = makeFakes();
    app = makeApp({
      intervals: fakes.intervals as unknown as WhoopWebhookDeps['intervals'],
      whoop: fakes.whoop as unknown as WhoopWebhookDeps['whoop'],
      clientSecret: CLIENT_SECRET,
    });
  });

  const recoveryPayload: WhoopWebhookPayload = {
    user_id: ATHLETE_USER_ID,
    id: 'recovery-uuid',
    type: 'recovery.updated',
    trace_id: 'trace-1',
  };

  it('returns 401 when the signature header is missing', async () => {
    const res = await postWebhook(app, recoveryPayload, { signature: '' });
    expect(res.status).toBe(401);
    await flushAsync();
    expect(fakes.intervals.updateWellness).not.toHaveBeenCalled();
  });

  it('returns 401 when the signature is wrong', async () => {
    const res = await postWebhook(app, recoveryPayload, { signature: 'bogus-signature' });
    expect(res.status).toBe(401);
    await flushAsync();
    expect(fakes.intervals.updateWellness).not.toHaveBeenCalled();
  });

  it('returns 401 when the timestamp is stale (>5 min skew)', async () => {
    const stale = String(Date.now() - 10 * 60 * 1000);
    const res = await postWebhook(app, recoveryPayload, { timestamp: stale });
    expect(res.status).toBe(401);
    await flushAsync();
    expect(fakes.intervals.updateWellness).not.toHaveBeenCalled();
  });

  it('returns 403 when user_id does not match the configured athlete', async () => {
    const res = await postWebhook(app, { ...recoveryPayload, user_id: 999 });
    expect(res.status).toBe(403);
    await flushAsync();
    expect(fakes.intervals.updateWellness).not.toHaveBeenCalled();
  });

  it('returns 200 and refreshes today\'s WhoopStrain for any event type', async () => {
    fakes.whoop.getStrainData.mockResolvedValueOnce([
      { date: todayUTC(), strain_score: 11.7, strain_level: 'Moderate', strain_level_description: '', activities: [] },
    ]);

    const res = await postWebhook(app, recoveryPayload);
    expect(res.status).toBe(200);

    await flushAsync();
    expect(fakes.intervals.updateWellness).toHaveBeenCalledWith(todayUTC(), { WhoopStrain: 11.7 });
    expect(fakes.intervals.updateActivity).not.toHaveBeenCalled();
  });

  it('on sleep.updated, also refreshes yesterday\'s WhoopStrain', async () => {
    const today = todayUTC();
    const yesterday = ymdAddDays(today, -1);
    fakes.whoop.getStrainData.mockImplementation(async (start: string) => {
      if (start === today) {
        return [{ date: today, strain_score: 10, strain_level: 'Moderate', strain_level_description: '', activities: [] }];
      }
      if (start === yesterday) {
        return [{ date: yesterday, strain_score: 14.2, strain_level: 'High', strain_level_description: '', activities: [] }];
      }
      return [];
    });

    const res = await postWebhook(app, {
      user_id: ATHLETE_USER_ID,
      id: 'sleep-uuid',
      type: 'sleep.updated',
      trace_id: 'trace-sleep',
    });
    expect(res.status).toBe(200);

    await flushAsync();
    expect(fakes.intervals.updateWellness).toHaveBeenCalledWith(today, { WhoopStrain: 10 });
    expect(fakes.intervals.updateWellness).toHaveBeenCalledWith(yesterday, { WhoopStrain: 14.2 });
  });

  it('on workout.updated, updates WhoopWorkoutStrain on the matching Intervals.icu activity', async () => {
    const whoopWorkout = {
      id: 'workout-uuid',
      activity_type: 'Running' as const,
      start_time: '2024-12-15T10:00:00+00:00',
      end_time: '2024-12-15T11:00:00+00:00',
      duration: '1:00:00',
      strain_score: 13.5,
    };
    fakes.whoop.getWorkoutById.mockResolvedValueOnce(whoopWorkout);
    fakes.intervals.getActivities.mockResolvedValueOnce([
      {
        id: 'icu-act-1',
        start_time: '2024-12-15T10:02:00+00:00',
        activity_type: 'Running',
        source: 'intervals.icu',
      },
    ]);

    const res = await postWebhook(app, {
      user_id: ATHLETE_USER_ID,
      id: 'workout-uuid',
      type: 'workout.updated',
      trace_id: 'trace-workout',
    });
    expect(res.status).toBe(200);

    await flushAsync();
    expect(fakes.whoop.getWorkoutById).toHaveBeenCalledWith('workout-uuid');
    expect(fakes.intervals.updateActivity).toHaveBeenCalledWith('icu-act-1', {
      WhoopWorkoutStrain: 13.5,
    });
  });

  it('on workout.updated with no matching Intervals.icu activity, logs and skips without throwing', async () => {
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakes.whoop.getWorkoutById.mockResolvedValueOnce({
      id: 'orphan-uuid',
      activity_type: 'Cycling' as const,
      start_time: '2024-12-15T06:00:00+00:00',
      end_time: '2024-12-15T07:00:00+00:00',
      duration: '1:00:00',
      strain_score: 7.0,
    });
    fakes.intervals.getActivities.mockResolvedValueOnce([]); // no candidates

    const res = await postWebhook(app, {
      user_id: ATHLETE_USER_ID,
      id: 'orphan-uuid',
      type: 'workout.updated',
      trace_id: 'trace-orphan',
    });
    expect(res.status).toBe(200);

    await flushAsync();
    expect(fakes.intervals.updateActivity).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warn.mockRestore();
    errorSpy.mockRestore();
  });

  it('swallows downstream errors after responding 200', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakes.intervals.updateWellness.mockRejectedValueOnce(new Error('intervals.icu down'));
    fakes.whoop.getStrainData.mockResolvedValueOnce([
      { date: todayUTC(), strain_score: 9.0, strain_level: 'Light', strain_level_description: '', activities: [] },
    ]);

    const res = await postWebhook(app, recoveryPayload);
    expect(res.status).toBe(200);

    await flushAsync();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('dispatchWhoopWebhook (direct)', () => {
  it('does not write workout strain when the Whoop workout is not SCORED yet', async () => {
    const fakes = makeFakes();
    fakes.whoop.getWorkoutById.mockResolvedValueOnce(null); // simulates not SCORED / 404
    fakes.whoop.getStrainData.mockResolvedValueOnce([]);
    await dispatchWhoopWebhook(
      {
        user_id: ATHLETE_USER_ID,
        id: 'pending-uuid',
        type: 'workout.updated',
        trace_id: 't',
      },
      {
        intervals: fakes.intervals as unknown as WhoopWebhookDeps['intervals'],
        whoop: fakes.whoop as unknown as WhoopWebhookDeps['whoop'],
        clientSecret: CLIENT_SECRET,
      }
    );
    expect(fakes.intervals.updateActivity).not.toHaveBeenCalled();
  });
});

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
