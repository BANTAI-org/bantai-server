import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role-enum';
import { ShiftService } from './shift.service';
import { ShiftStatusDto } from './dto/shift-status.dto';
import { ExtendShiftDto } from './dto/extend-shift.dto';

/**
 * Read / extend the caller's current shift. Toggling on/off duty lives
 * in the drivers / responders modules — this controller only touches
 * the shift_ends_at timer that those modules set.
 */
@Controller('shift')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Shift')
@ApiBearerAuth('access-token')
export class ShiftController {
  constructor(private readonly service: ShiftService) {}

  @Get()
  @ApiOperation({ summary: "Get the caller's current shift status" })
  @ApiResponse({ status: 200, type: ShiftStatusDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @Roles(Role.DRIVER, Role.RESPONDER)
  @ApiRoles(Role.DRIVER, Role.RESPONDER)
  getMine(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<ShiftStatusDto> {
    return this.service.getShiftStatus(userId, role);
  }

  @Post('extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Extend the current shift',
    description:
      'Adds `minutes` to shift_ends_at. Clamped from now when the shift is already past its end (between cron ticks).',
  })
  @ApiBody({ type: ExtendShiftDto })
  @ApiResponse({ status: 200, type: ShiftStatusDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Not on duty' })
  @Roles(Role.DRIVER, Role.RESPONDER)
  @ApiRoles(Role.DRIVER, Role.RESPONDER)
  extend(
    @Body() dto: ExtendShiftDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<ShiftStatusDto> {
    return this.service.extendShift(userId, role, dto.minutes);
  }
}
