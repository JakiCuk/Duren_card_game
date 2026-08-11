import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

describe('server skeleton', () => {
  it('answers /healthz', async () => {
    const app = await buildServer(loadConfig({ LOG_LEVEL: 'silent' }));
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, protocol: 1 });
    } finally {
      await app.close();
    }
  });

  it('reads PORT and MAX_ROOMS from the environment', () => {
    expect(loadConfig({ PORT: '8080', MAX_ROOMS: '12' })).toMatchObject({
      port: 8080,
      maxRooms: 12,
    });
  });

  it('rejects a non-numeric PORT rather than silently falling back', () => {
    expect(() => loadConfig({ PORT: 'nope' })).toThrow();
  });
});
