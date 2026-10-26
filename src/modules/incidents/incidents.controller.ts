import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role-enum';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { CursorPageResponseDto } from './dto/cursor-page-response.dto';
import { EscalateIncidentDto } from './dto/escalare-incident.dto';
import { FindIncidentLogsQueryDto } from './dto/find-incident-logs-query.dto';
import { FindIncidentsByStatusQueryDto } from './dto/find-incidents-by-status-query.dto';
import { IncidentIdParamDto } from './dto/id-params.dto';
import { MarkArrivedDto } from './dto/mark-arrived.dto';
import { RecordPeerResponseDto } from './dto/record-peer-response.dto';
import { ResolveIncidentDto } from './dto/resolve-incident.dto';
import { UpdateSeverityDto } from './dto/update-severity.dto';
import { UpdateThreatLevelDto } from './dto/update-threat-level.dto';
import { VerifyIncidentDto } from './dto/verify-incident.dto';
import { IncidentService } from './incidents.service';
import { IncidentEntity } from './interfaces/incident-entity.interface';
import { IncidentLogEntity } from './interfaces/incident-log-entity.interface';
import { IncidentStatus } from './enums/incident-status.enum';
import { TriggerSource } from './enums/trigger-source.enum';
import { EdgeApiKeyGuard } from '../../common/guards/edge-api-key-guard';
import { Public } from '../../common/decorators/public.decorator';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

const ANY_USER = [Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER];

@Controller('incidents')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Incidents')
@ApiBearerAuth('access-token')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  // =====================================================================
  // EDGE AI / KVM WEBHOOK
  // MUST BE PLACED BEFORE @Get(':incidentId') so Nest matches it correctly
  // =====================================================================
  @Post('edge')
  @Public() // Bypasses the class-level JwtGuard
  @UseGuards(EdgeApiKeyGuard) // Protects with the API Key
  @ApiOperation({
    summary: 'Create an incident from an Edge AI KVM',
    description:
      'Accepts either `device_id` (UUID) or `hardware_serial` (String).',
  })
  @ApiResponse({ status: 201, description: 'Incident created' })
  @ApiResponse({ status: 401, description: 'Invalid Edge API Key' })
  async createEdgeIncident(
    @Body() dto: CreateIncidentDto,
  ): Promise<{ id: string }> {
    dto.trigger_source = TriggerSource.EDGE_AI;
    return {
      id: await this.incidentService.createEdgeIncident(dto),
    };
  }

  // =====================================================================
  // NORMAL ROUTES (Protected by JWT)
  // =====================================================================

  @Post()
  @ApiOperation({ summary: 'Create an incident' })
  @ApiBody({ type: CreateIncidentDto })
  @ApiResponse({ status: 201, description: 'Incident created' })
  @ApiResponse({ status: 400, description: 'Invalid incident data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  async create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ id: string }> {
    const source: string = dto.trigger_source;

    let resolvedDriverId: string | null = null;
    if (role === Role.DRIVER) {
      const allowedSources = ['MANUAL_SOS', 'CRASH_IMU', 'EDGE_AI'];
      if (!allowedSources.includes(source)) {
        throw new ForbiddenException(
          'Riders can only raise SOS, IMU crash, or Edge AI incidents',
        );
      }
      resolvedDriverId = userId;
    } else if (source !== 'CENTER_MANUAL') {
      throw new ForbiddenException(
        'Command centers can only log CENTER_MANUAL incidents',
      );
    }

    return {
      id: await this.incidentService.createIncident(dto, resolvedDriverId),
    };
  }

  @Get()
  @ApiOperation({ summary: 'List incidents by status' })
  @ApiQuery({
    name: 'statuses',
    required: true,
    type: String,
    isArray: true,
    enum: IncidentStatus,
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Incident page returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.SUPER)
  @ApiRoles(Role.SUPER)
  async listByStatus(
    @Query() query: FindIncidentsByStatusQueryDto,
  ): Promise<CursorPageResponseDto<IncidentEntity>> {
    const page = await this.incidentService.listIncidentsByStatus(
      query.statuses,
      { limit: query.limit, cursor: query.cursor },
    );
    return CursorPageResponseDto.from(page, (incident) => incident);
  }

  @Get('all')
  @ApiOperation({ summary: 'List open incidents for the authenticated driver' })
  @ApiResponse({ status: 200, description: 'Open incidents returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.DRIVER)
  @ApiRoles(Role.DRIVER)
  async getOpenIncidentsForDriver(
    @CurrentUser('sub') driverId: string,
  ): Promise<IncidentEntity[]> {
    return this.incidentService.findOpenIncidentsByDriver(driverId);
  }

  @Get('assignment/current')
  @ApiOperation({
    summary: 'Get current active assignment for the authenticated responder',
  })
  @ApiResponse({ status: 200, description: 'Current assignment returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No active assignment' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async getCurrentAssignment(
    @CurrentUser('sub') responderId: string,
  ): Promise<IncidentEntity> {
    const assignment =
      await this.incidentService.getCurrentAssignment(responderId);
    if (!assignment) {
      throw new NotFoundException('No active assignment');
    }
    return assignment;
  }

  @Get('assignment/offers')
  @ApiOperation({
    summary: 'Get pending wave offers for the authenticated responder',
  })
  @ApiResponse({ status: 200, description: 'Pending offers returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async getPendingOffers(
    @CurrentUser('sub') responderId: string,
  ): Promise<IncidentEntity[]> {
    return this.incidentService.getPendingOffers(responderId);
  }

  @Get('assignment/history')
  @ApiOperation({
    summary: 'Get assignment history for the authenticated responder',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Assignment history returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async getAssignmentHistory(
    @CurrentUser('sub') responderId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<IncidentEntity[]> {
    return this.incidentService.getAssignmentHistory(
      responderId,
      limit ?? 50,
      offset ?? 0,
    );
  }

  @Get('logs')
  @ApiOperation({ summary: 'List incident logs for a command center' })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Incident log page returned' })
  @ApiResponse({ status: 400, description: 'Missing command center ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async logs(
    @Query() query: FindIncidentLogsQueryDto,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') ownCommandCenterId?: string,
  ): Promise<CursorPageResponseDto<IncidentLogEntity>> {
    let commandCenterId: string | undefined;
    if (role === Role.SUPER) {
      commandCenterId = query.command_center_id;
      if (!commandCenterId)
        throw new BadRequestException('command_center_id is required');
    } else {
      commandCenterId = ownCommandCenterId;
      if (!commandCenterId)
        throw new ForbiddenException(
          'You are not assigned to a command center',
        );
    }

    const page = await this.incidentService.listIncidentLogs(commandCenterId, {
      limit: query.limit,
      cursor: query.cursor,
    });
    return CursorPageResponseDto.from(page, (log) => log);
  }

  @Get(':incidentId')
  @ApiOperation({ summary: 'Get an incident by ID' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 200, description: 'Incident returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @Roles(...ANY_USER)
  @ApiRoles(...ANY_USER)
  async getOne(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<IncidentEntity> {
    return this.incidentService.getIncidentForUser(
      params.incidentId,
      userId,
      role,
    );
  }

  @Post(':incidentId/claim')
  @ApiOperation({ summary: 'Claim an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 204, description: 'Incident claimed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async claim(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.claimIncident(params.incidentId, userId);
  }

  @Post(':incidentId/en-route')
  @ApiOperation({ summary: 'Mark the responder as en route' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 204, description: 'Responder marked en route' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async enRoute(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.markEnRoute(params.incidentId, userId);
  }

  @Post(':incidentId/arrived')
  @ApiOperation({ summary: 'Record responder arrival at an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: MarkArrivedDto })
  @ApiResponse({ status: 204, description: 'Arrival recorded' })
  @ApiResponse({ status: 400, description: 'Invalid arrival method' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async arrived(
    @Param() params: IncidentIdParamDto,
    @Body() dto: MarkArrivedDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    const confirmedById = (dto.method as string) === 'manual' ? userId : null;
    await this.incidentService.markArrived(
      params.incidentId,
      userId,
      dto.method,
      confirmedById,
    );
  }

  @Post(':incidentId/stand-down')
  @ApiOperation({ summary: 'Stand down from an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 204, description: 'Responder stood down' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async standDown(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.standDown(params.incidentId, userId);
  }

  @Post(':incidentId/peer-response')
  @ApiOperation({ summary: 'Submit a peer response to an incident alert' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: RecordPeerResponseDto })
  @ApiResponse({ status: 204, description: 'Peer response recorded' })
  @ApiResponse({ status: 400, description: 'Invalid peer response status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.DRIVER)
  @ApiRoles(Role.DRIVER)
  async peerResponse(
    @Param() params: IncidentIdParamDto,
    @Body() dto: RecordPeerResponseDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.recordPeerResponse(
      params.incidentId,
      userId,
      dto.status,
    );
  }

  @Post(':incidentId/request-verification')
  @ApiOperation({ summary: 'Request incident verification' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 204, description: 'Verification requested' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async requestVerification(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.requestVerification(params.incidentId, userId);
  }

  @Post(':incidentId/verify')
  @ApiOperation({ summary: 'Verify an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: VerifyIncidentDto })
  @ApiResponse({ status: 204, description: 'Incident verified' })
  @ApiResponse({ status: 400, description: 'Invalid verification data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async verify(
    @Param() params: IncidentIdParamDto,
    @Body() dto: VerifyIncidentDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.verifyIncident(
      params.incidentId,
      userId,
      dto.notes,
    );
  }

  @Post(':incidentId/resolve')
  @ApiOperation({ summary: 'Resolve an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: ResolveIncidentDto })
  @ApiResponse({ status: 204, description: 'Incident resolved' })
  @ApiResponse({ status: 400, description: 'Invalid resolution outcome' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async resolve(
    @Param() params: IncidentIdParamDto,
    @Body() dto: ResolveIncidentDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.resolveIncident(
      params.incidentId,
      dto.outcome,
      userId,
    );
  }

  @Patch(':incidentId/threat-level')
  @ApiOperation({ summary: 'Update an incident threat level' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: UpdateThreatLevelDto })
  @ApiResponse({ status: 204, description: 'Threat level updated' })
  @ApiResponse({ status: 400, description: 'Invalid threat level' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async threatLevel(
    @Param() params: IncidentIdParamDto,
    @Body() dto: UpdateThreatLevelDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<void> {
    await this.requireStaffOrClaimant(params.incidentId, userId, role);
    await this.incidentService.updateThreatLevel(
      params.incidentId,
      dto.threat_level,
      userId,
    );
  }

  @Patch(':incidentId/severity')
  @ApiOperation({ summary: 'Update an incident severity' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: UpdateSeverityDto })
  @ApiResponse({ status: 204, description: 'Incident severity updated' })
  @ApiResponse({ status: 400, description: 'Invalid severity' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async severity(
    @Param() params: IncidentIdParamDto,
    @Body() dto: UpdateSeverityDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.updateSeverity(
      params.incidentId,
      dto.severity,
      userId,
    );
  }

  @Post(':incidentId/escalate')
  @ApiOperation({ summary: 'Escalate an incident to another command center' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiBody({ type: EscalateIncidentDto })
  @ApiResponse({ status: 201, description: 'Incident escalated' })
  @ApiResponse({ status: 400, description: 'Invalid escalation data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async escalate(
    @Param() params: IncidentIdParamDto,
    @Body() dto: EscalateIncidentDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ id: string }> {
    await this.requireStaffOrClaimant(params.incidentId, userId, role);
    const id = await this.incidentService.escalateIncident(
      params.incidentId,
      dto.command_center_id,
      dto.reason,
      userId,
      dto.notes,
    );
    return { id };
  }

  @Post(':incidentId/cancel')
  @ApiOperation({ summary: 'Cancel an incident' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 204, description: 'Incident cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  async cancel(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<void> {
    if (role === Role.DRIVER) {
      const incident = await this.incidentService.getIncident(
        params.incidentId,
      );
      if (incident.driver_id !== userId) {
        throw new ForbiddenException('You can only cancel your own incident');
      }
    }
    await this.incidentService.cancelIncident(params.incidentId, userId);
  }

  private async requireStaffOrClaimant(
    incidentId: string,
    userId: string,
    role: Role,
  ): Promise<void> {
    if (role === Role.ADMIN || role === Role.SUPER) return;
    const incident = await this.incidentService.getIncident(incidentId);
    if (incident.claimed_by_id !== userId) {
      throw new ForbiddenException(
        'Only the responder who claimed this incident, an admin or a super can do this',
      );
    }
  }
}