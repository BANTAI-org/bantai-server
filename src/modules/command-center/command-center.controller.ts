import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommandCenterService } from './command-center.service';
import { CreateCommandCenterDTO } from './dto/create-command-center.dto';
import { UpdateCommandCenterDTO } from './dto/update-command-center.dto';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { ResponderTableRow } from './interfaces/responder-tb.interface';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('command-centers')
@UseGuards(JwtGuard, RolesGuard)
export class CommandCenterController {
  constructor(private readonly commandCenterService: CommandCenterService) {}

  @Post()
  @Roles(Role.SUPER)
  async create(
    @Body() dto: CreateCommandCenterDTO,
  ): Promise<CommandCenterEntity> {
    return this.commandCenterService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCommandCenterDTO,
  ): Promise<CommandCenterEntity> {
    return this.commandCenterService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.commandCenterService.delete(id);
  }

  // -------------------------------------------------------------
  // Responder management. Super: any branch. Admin: own branch only
  // (enforced in the service, from the database).
  // -------------------------------------------------------------

  @Get(':centerId/responders')
  @Roles(Role.SUPER, Role.ADMIN)
  async listResponders(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<ResponderTableRow[]> {
    return this.commandCenterService.getBranchResponders(userId, centerId);
  }

  @Patch(':centerId/responders/:responderId/deactivate')
  @Roles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateResponder(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    return this.commandCenterService.deactivateResponder(
      userId,
      centerId,
      responderId,
    );
  }

  @Patch(':centerId/responders/:responderId/activate')
  @Roles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async activateResponder(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.activateResponder(
      req.user.sub,
      centerId,
      responderId,
    );
  }

  @Post(':centerId/responders/:responderId/revoke-sessions')
  @Roles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeResponderSessions(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.revokeResponderSessions(
      req.user.sub,
      centerId,
      responderId,
    );
  }

  @Post(':centerId/responders/:responderId/force-password-reset')
  @Roles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async forceResponderPasswordReset(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.forceResponderPasswordReset(
      req.user.sub,
      centerId,
      responderId,
    );
  }
}
