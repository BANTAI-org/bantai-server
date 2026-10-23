import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { QueryResult } from 'pg';
import { DatabaseService } from './database/database.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

interface HealthCheckDbRow {
  postgres_version: string;
  postgis_version: string;
  db_time: Date;
}

@Controller('health')
@ApiTags('Health')
export class AppController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and database health' })
  @ApiResponse({ status: 200, description: 'API and database are available' })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  async checkHealth() {
    const startTime = Date.now();

    try {
      const result: QueryResult<HealthCheckDbRow> = await this.db.query(`
        SELECT 
          version() AS postgres_version, 
          postgis_full_version() AS postgis_version,
          NOW() AS db_time
      `);

      const latencyMs = Date.now() - startTime;
      const row = result.rows[0];

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        services: {
          database: {
            status: 'up',
            latencyMs: `${latencyMs}ms`,
            dbTime: row.db_time.toISOString(),
            postgresVersion: row.postgres_version,
            postgisVersion: row.postgis_version,
          },
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Database ping failed';

      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        services: {
          database: {
            status: 'down',
            error: errorMessage,
          },
        },
      });
    }
  }
}
