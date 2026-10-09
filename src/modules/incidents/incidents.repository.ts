import { DatabaseService } from '../../database/database.service';
import { CreateIncidentData } from './types/datas/create-incident-data.types';

export class IncidentRepository {
  constructor(private readonly db: DatabaseService) {}

  async createIncident(data: CreateIncidentData): Promise<boolean> {
    const {
      driver_id,
      device_id,
      location,
      trigger_source,
      detected_class,
      confidence_level,
      evidence,
      threat_type,
      threat_category,
      severity,
    } = data;

    const sql = `
      INSERT INTO incident (
        driver_id, device_id, location, trigger_source, detected_class,
        confidence_level, evidence, threat_type, threat_category, severity
      )
      VALUES (
        $1, $2,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
        $5, $6, $7, $8::jsonb, $9, $10,
        COALESCE($11::incident_severity_enum, 'UNKNOWN')
      )`;

    const result = await this.db.query(sql, [
      driver_id,
      device_id,
      location.longitude,
      location.latitude,
      trigger_source,
      detected_class ?? null,
      confidence_level ?? null,
      JSON.stringify(evidence ?? []),
      threat_type,
      threat_category,
      severity ?? null,
    ]);

    return result.rowCount === 1;
  }
}
