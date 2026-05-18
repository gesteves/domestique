import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

vi.mock('../../src/services/description-regen.js', () => ({
  regenerateDayDescriptions: vi
    .fn()
    .mockResolvedValue({ date: '2024-12-15', regenerated: [], skipped: [] }),
}));

import { createRegenerateDescriptionsApiHandler } from '../../src/api/regenerate-descriptions.js';
import { regenerateDayDescriptions } from '../../src/services/description-regen.js';

const SECRET = 'api-secret';
const regenMock = regenerateDayDescriptions as unknown as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/api/activities/descriptions',
    createRegenerateDescriptionsApiHandler({
      intervals: {} as never,
      whoop: null,
      trainerroad: null,
      secret: SECRET,
    })
  );
  return app;
}

async function post(
  body: unknown,
  opts: { auth?: string; query?: string } = {}
): Promise<{ status: number; body: any }> {
  const app = makeApp();
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as { port: number }).port;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.auth) headers.Authorization = opts.auth;
        const res = await fetch(
          `http://127.0.0.1:${port}/api/activities/descriptions${opts.query ?? ''}`,
          { method: 'POST', headers, body: JSON.stringify(body) }
        );
        const json = await res.json().catch(() => ({}));
        server.close();
        resolve({ status: res.status, body: json });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

/** Drain the fire-and-forget Promise chain scheduled after the 202 response. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}

describe('POST /api/activities/descriptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 when no token is provided', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(regenMock).not.toHaveBeenCalled();
  });

  it('401 when the secret is only supplied as a query parameter', async () => {
    const res = await post({ date: '2024-12-15' }, { query: `?token=${SECRET}` });
    expect(res.status).toBe(401);
    await flushAsync();
    expect(regenMock).not.toHaveBeenCalled();
  });

  it('403 when the token is wrong', async () => {
    const res = await post({}, { auth: 'Bearer nope' });
    expect(res.status).toBe(403);
    expect(regenMock).not.toHaveBeenCalled();
  });

  it('400 when date is malformed', async () => {
    const res = await post({ date: '2024-13-40' }, { auth: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
    expect(regenMock).not.toHaveBeenCalled();
  });

  it('202 immediately and regenerates today when no date is given', async () => {
    const res = await post({}, { auth: `Bearer ${SECRET}` });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    await flushAsync();
    expect(regenMock).toHaveBeenCalledTimes(1);
    expect(regenMock.mock.calls[0][0]).toEqual({ activityId: null, date: null });
  });

  it('202 and regenerates the given date with a valid Bearer token', async () => {
    const res = await post({ date: '2024-12-15' }, { auth: `Bearer ${SECRET}` });
    expect(res.status).toBe(202);
    await flushAsync();
    expect(regenMock).toHaveBeenCalledTimes(1);
    expect(regenMock.mock.calls[0][0]).toEqual({ activityId: null, date: '2024-12-15' });
  });

  it('202 and regenerates a single activity_id, taking precedence over date', async () => {
    // Malformed date must NOT 400 when activity_id is present (date ignored).
    const res = await post(
      { activity_id: ' i123 ', date: '2024-13-40' },
      { auth: `Bearer ${SECRET}` }
    );
    expect(res.status).toBe(202);
    await flushAsync();
    expect(regenMock).toHaveBeenCalledTimes(1);
    expect(regenMock.mock.calls[0][0]).toEqual({ activityId: 'i123', date: null });
  });
});
