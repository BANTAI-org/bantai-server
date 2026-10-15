import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { DashboardStatsDto } from './interfaces/dashboard-stats.dto';

@Injectable()
export class DashboardRepository {
  constructor(private readonly db: DatabaseService) {}

  async getDashboardStats(commandCenterId: string): Promise<DashboardStatsDto> {
    const [incidentResult, activePersonnelResult, gunResult, bladeResult, collisionResult] = await Promise.all([
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM incident i
         JOIN user_account u ON i.driver_id = u.id
         WHERE u.command_center_id = $1`,
        [commandCenterId]
      ),
      this.db.query<{ total: number }>(
        'SELECT COUNT(*) AS total FROM user_account WHERE account_status = $1 AND command_center_id = $2',
        ['active', commandCenterId]
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM incident i
         JOIN user_account u ON i.driver_id = u.id
         WHERE i.threat_type = $1 AND u.command_center_id = $2`,
        ['GUN', commandCenterId]
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM incident i
         JOIN user_account u ON i.driver_id = u.id
         WHERE i.threat_type = $1 AND u.command_center_id = $2`,
        ['BLADE', commandCenterId]
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM incident i
         JOIN user_account u ON i.driver_id = u.id
         WHERE i.threat_type = $1 AND u.command_center_id = $2`,
        ['COLLISION', commandCenterId]
      ),
    ]);

    return {
      totalIncidents: incidentResult.rows[0].total,
      totalActivePersonnel: activePersonnelResult.rows[0].total,
      totalGunIncidents: gunResult.rows[0].total,
      totalBladeIncidents: bladeResult.rows[0].total,
      totalCollisionIncidents: collisionResult.rows[0].total,
    };
  }
}