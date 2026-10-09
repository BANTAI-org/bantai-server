import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IncidentController } from './incidents.controller';
import { IncidentService } from './incidents.service';
import { IncidentRepository } from './incidents.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [IncidentController],
  providers: [IncidentService, IncidentRepository],
  exports: [IncidentService],
})
export class IncidentModule {}
