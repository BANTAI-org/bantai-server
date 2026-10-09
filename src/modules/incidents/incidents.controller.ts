import { Body, Controller, Post } from '@nestjs/common';
import { IncidentService } from './incidents.service';
import { CreateIncidentDTO } from './dto/create-incident.dto';

@Controller('incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Post()
  async createIncident(
    @Body() dto: CreateIncidentDTO,
  ): Promise<{ success: boolean }> {
    const success = await this.incidentService.createIncident(dto);
    return { success };
  }
}
