import { describe, expect, it } from '@jest/globals';
import { AppController } from './app.controller';
import { DatabaseService } from './database/database.service';

describe('AppController', () => {
  it('reports a successful database health check', async () => {
    const dbTime = new Date('2026-10-13T00:00:00.000Z');
    const database = {
      query: () =>
        Promise.resolve({
          rows: [
            {
              postgres_version: 'PostgreSQL test',
              postgis_version: 'PostGIS test',
              db_time: dbTime,
            },
          ],
        }),
    } as unknown as DatabaseService;
    const controller = new AppController(database);

    const result = await controller.checkHealth();

    expect(result.status).toBe('ok');
    expect(result.services.database).toMatchObject({
      status: 'up',
      dbTime: dbTime.toISOString(),
      postgresVersion: 'PostgreSQL test',
      postgisVersion: 'PostGIS test',
    });
  });
});
