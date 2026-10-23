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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommandCenterService } from './command-center.service';
import { CreateCommandCenterDTO } from './dto/create-command-center.dto';
import { UpdateCommandCenterDTO } from './dto/update-command-center.dto';
import { UpdateResponderEmailDTO } from './dto/update-email.dto';
import { ResponderFilterDTO } from './dto/responder-filter.dto';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { ResponderTableRow } from './interfaces/responder-tb.interface';
import { ActorOption } from './interfaces/action-option.interface';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountStatusEnum } from '../../modules/auth/enums/account-status.enum';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('command-centers')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Command Centers')
@ApiBearerAuth('access-token')
export class CommandCenterController {
  constructor(private readonly commandCenterService: CommandCenterService) {}

  @Post()
  @ApiOperation({ summary: 'Create a command center' })
  @ApiBody({ type: CreateCommandCenterDTO })
  @ApiResponse({ status: 201, description: 'Command center created' })
  @ApiResponse({ status: 400, description: 'Invalid command center data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER)
  @ApiRoles(Role.SUPER)
  async create(
    @Body() dto: CreateCommandCenterDTO,
  ): Promise<CommandCenterEntity> {
    return this.commandCenterService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a command center' })
  @ApiParam({ name: 'id', description: 'Command center UUID' })
  @ApiBody({ type: UpdateCommandCenterDTO })
  @ApiResponse({ status: 200, description: 'Command center updated' })
  @ApiResponse({ status: 400, description: 'Invalid command center data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Command center not found' })
  @Roles(Role.SUPER)
  @ApiRoles(Role.SUPER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCommandCenterDTO,
  ): Promise<CommandCenterEntity> {
    return this.commandCenterService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a command center' })
  @ApiParam({ name: 'id', description: 'Command center UUID' })
  @ApiResponse({ status: 204, description: 'Command center deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Command center not found' })
  @Roles(Role.SUPER)
  @ApiRoles(Role.SUPER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.commandCenterService.delete(id);
  }

  // -------------------------------------------------------------
  // Responder management. Super: any branch. Admin: own branch only
  // (enforced in the service, from the database).
  // -------------------------------------------------------------

  @Get(':centerId/responders')
  @ApiOperation({ summary: 'List responders in a command center' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiResponse({ status: 200, description: 'Responders returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async listResponders(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @CurrentUser('sub')
    userId: string,
  ): Promise<ResponderTableRow[]> {
    return this.commandCenterService.getBranchResponders(userId, centerId);
  }

  @Get(':centerId/responders/paginated')
  @ApiOperation({ summary: 'List responders in a command center by page' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Responder page returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async listRespondersPaginated(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @CurrentUser('sub')
    userId: string,
    @Query('limit') limit: number = 20,
    @Query('cursor') cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    return this.commandCenterService.getBranchRespondersPaginated(
      userId,
      centerId,
      limit,
      cursor,
    );
  }

  @Get(':centerId/responders/status/:status')
  @ApiOperation({ summary: 'List command center responders by account status' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'status', description: 'Responder account status' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Responder page returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async listRespondersByStatusPaginated(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('status') status: AccountStatusEnum,
    @CurrentUser('sub')
    userId: string,
    @Query('limit') limit: number = 20,
    @Query('cursor') cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    return this.commandCenterService.getBranchRespondersByStatusPaginated(
      userId,
      centerId,
      status,
      limit,
      cursor,
    );
  }

  @Get(':centerId/responders/filter')
  @ApiOperation({
    summary: 'Filter responders in a command center',
    description:
      'All filters compose with AND. Multi-value filters are accepted as ' +
      'repeated params (`?status=active&status=deactivated`) or ' +
      'comma-separated (`?status=active,deactivated`). ' +
      'Date-only values are anchored to UTC days. ' +
      'Soft-deleted (deactivated) responders are excluded unless ' +
      '`includeSoftDeleted=true`.',
  })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiResponse({ status: 200, description: 'Responder page returned' })
  @ApiResponse({ status: 400, description: 'Invalid filter parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not your command center' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async filterResponders(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() filter: ResponderFilterDTO,
    @CurrentUser('sub') userId: string,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    return this.commandCenterService.filterResponders(userId, centerId, filter);
  }

  @Get(':centerId/actors')
  @ApiOperation({
    summary: 'List admins and responders in a command center',
    description:
      'Returns the id and name of users in the branch. Used to populate the "Filter Actor" dropdown in the audit log UI.',
  })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiResponse({ status: 200, description: 'Actors returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async getBranchActors(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<ActorOption[]> {
    return this.commandCenterService.getBranchActors(userId, centerId);
  }

  @Patch(':centerId/responders/:responderId/deactivate')
  @ApiOperation({ summary: 'Deactivate a responder account' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'responderId', description: 'Responder UUID' })
  @ApiResponse({ status: 204, description: 'Responder deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Responder not found' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateResponder(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @CurrentUser('sub')
    userId: string,
  ): Promise<void> {
    return this.commandCenterService.deactivateResponder(
      userId,
      centerId,
      responderId,
    );
  }

  @Patch(':centerId/responders/:responderId/activate')
  @ApiOperation({ summary: 'Activate a responder account' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'responderId', description: 'Responder UUID' })
  @ApiResponse({ status: 204, description: 'Responder activated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Responder not found' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async activateResponder(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req()
    req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.activateResponder(
      req.user.sub,
      centerId,
      responderId,
    );
  }

  @Post(':centerId/responders/:responderId/revoke-sessions')
  @ApiOperation({ summary: 'Revoke all responder sessions' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'responderId', description: 'Responder UUID' })
  @ApiResponse({ status: 204, description: 'Responder sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Responder not found' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeResponderSessions(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req()
    req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.revokeResponderSessions(
      req.user.sub,
      centerId,
      responderId,
    );
  }

  @Post(':centerId/responders/:responderId/force-password-reset')
  @ApiOperation({ summary: 'Require a responder password reset' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'responderId', description: 'Responder UUID' })
  @ApiResponse({ status: 204, description: 'Password reset required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Responder not found' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async forceResponderPasswordReset(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Req()
    req: AuthenticatedRequest,
  ): Promise<void> {
    return this.commandCenterService.forceResponderPasswordReset(
      req.user.sub,
      centerId,
      responderId,
    );
  }

  @Patch(':centerId/responders/:responderId/email')
  @ApiOperation({ summary: 'Update a responder email address' })
  @ApiParam({ name: 'centerId', description: 'Command center UUID' })
  @ApiParam({ name: 'responderId', description: 'Responder UUID' })
  @ApiBody({ type: UpdateResponderEmailDTO })
  @ApiResponse({ status: 200, description: 'Responder email updated' })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Responder not found' })
  @Roles(Role.SUPER, Role.ADMIN)
  @ApiRoles(Role.SUPER, Role.ADMIN)
  async updateResponderEmail(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('responderId', ParseUUIDPipe) responderId: string,
    @Body() dto: UpdateResponderEmailDTO,
    @CurrentUser('sub') actorId: string,
  ): Promise<string> {
    return await this.commandCenterService.updateEmail(
      dto.email,
      responderId,
      centerId,
      actorId,
    );
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user command center' })
  @ApiResponse({ status: 200, description: 'Command center returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async getMyCommandCenter(
    @CurrentUser('sub') userId: string,
  ): Promise<CommandCenterEntity | null> {
    return await this.commandCenterService.getMyCommandCenter(userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all command centers' })
  @ApiResponse({ status: 200, description: 'Command centers returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER)
  @ApiRoles(Role.SUPER)
  async getAllCommandCenters(): Promise<CommandCenterEntity[]> {
    const centers = await this.commandCenterService.getAll();
    if (!centers) {
      return [];
    }
    return centers;
  }
}
