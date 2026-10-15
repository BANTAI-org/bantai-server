import { Injectable } from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository';
import { DashboardStatsDto } from './interfaces/dashboard-stats.dto';

@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async getDashboardStats(commandCenterId: string): Promise<DashboardStatsDto> {
    return this.dashboardRepository.getDashboardStats(commandCenterId);
  }
}
