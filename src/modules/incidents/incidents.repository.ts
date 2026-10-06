import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export class IncidentRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: Logger,
  ) {}

  async createIncident() {}
}
