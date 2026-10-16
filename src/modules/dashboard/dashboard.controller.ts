import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';
import { DashboardStatsDto } from './interfaces/dashboard-stats.dto';

@Controller('dashboard')
@UseGuards(JwtGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @Roles(Role.ADMIN, Role.SUPER)
  async getStats(
    @CurrentUser() user: JwtPayload,
    @Query('commandCenterId') commandCenterId?: string,
  ): Promise<DashboardStatsDto> {
    let centerId: string;
    if (user.role === Role.ADMIN) {
      if (!user.command_center_id) {
        throw new BadRequestException('commandCenterId is required for admin');
      }
      centerId = user.command_center_id;
    } else if (user.role === Role.SUPER) {
      if (!commandCenterId) {
        throw new BadRequestException(
          'commandCenterId is required for super admin',
        );
      }
      centerId = commandCenterId!;
    } else {
      throw new BadRequestException('Invalid role');
    }

    return this.dashboardService.getDashboardStats(centerId);
  }
}
