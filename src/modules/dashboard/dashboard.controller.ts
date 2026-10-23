import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';
import { DashboardStatsDto } from './interfaces/dashboard-stats.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('dashboard')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiQuery({
    name: 'commandCenterId',
    required: false,
    type: String,
    description:
      'Required for super administrators; ignored for administrators',
  })
  @ApiResponse({ status: 200, description: 'Dashboard statistics returned' })
  @ApiResponse({
    status: 400,
    description: 'Invalid or missing command center',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
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
