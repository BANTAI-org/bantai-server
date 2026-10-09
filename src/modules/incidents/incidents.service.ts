import { BadRequestException, Injectable } from '@nestjs/common';
import { IncidentRepository } from './incidents.repository';
import { CreateIncidentDTO } from './dto/create-incident.dto';
import { TriggerSource } from './enums/trigger-source.enum';
import { ThreatCategory } from './enums/threat-category.enum';
import { ThreatType } from './enums/threat-type.enum';

@Injectable()
export class IncidentService {
  constructor(private readonly incidentRepository: IncidentRepository) {}

  async createIncident(dto: CreateIncidentDTO): Promise<boolean> {
    const isWeapon =
      dto.threat_type === ThreatType.GUN ||
      dto.threat_type === ThreatType.BLADE;

    if (isWeapon && dto.threat_category !== ThreatCategory.HAZARD) {
      throw new BadRequestException(
        'GUN and BLADE incidents must have threat_category HAZARD',
      );
    }

    if (
      dto.threat_type === ThreatType.CONFRONTATION &&
      dto.threat_category === ThreatCategory.ASSIST
    ) {
      throw new BadRequestException(
        'CONFRONTATION incidents cannot have threat_category ASSIST',
      );
    }

    if (
      dto.trigger_source === TriggerSource.EDGE_AI &&
      dto.confidence_level == null
    ) {
      throw new BadRequestException(
        'EDGE_AI incidents require confidence_level',
      );
    }

    return this.incidentRepository.createIncident(dto);
  }
}
