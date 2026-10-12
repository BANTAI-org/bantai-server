import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
// TODO: point these four at your real files.
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
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

const ANY_USER = [Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER];

/**
 * The caller's id is always `@CurrentUser('sub')` from the verified token:
 * responder, verifier, resolver and peer ids are never read from the body or
 * the URL. Finer rules (is this responder the claimant, four-eyes verification)
 * live in the repository SQL and the service.
 */
@Controller('incidents')
@UseGuards(JwtGuard, RolesGuard)
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  // ---------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------

  /**
   * A rider raises an SOS (MANUAL_SOS), or a command center logs a walk-in
   * report (CENTER_MANUAL). EDGE_AI incidents come from the AI pipeline, not a
   * user account, and need their own intake route.
   */
  @Post()
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  async create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ id: string }> {
    const source: string = dto.trigger_source;

    let resolvedDriverId: string | null = null;
    if (role === Role.DRIVER) {
      if (source !== 'MANUAL_SOS') {
        throw new ForbiddenException('Riders can only raise SOS incidents');
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

  // ---------------------------------------------------------------------
  // READS (the fixed paths come before :incidentId so "logs" is not an id)
  // ---------------------------------------------------------------------

  /** Every incident in the given statuses, across all centers: supers only. */
  @Get()
  @Roles(Role.SUPER)
  async listByStatus(
    @Query() query: FindIncidentsByStatusQueryDto,
  ): Promise<CursorPageResponseDto<IncidentEntity>> {
    const page = await this.incidentService.listIncidentsByStatus(
      query.statuses,
      { limit: query.limit, cursor: query.cursor },
    );
    return CursorPageResponseDto.from(page, (incident) => incident);
  }

  /**
   * A command center's incident log. An admin sees their own center whatever
   * they ask for; a super has to name one.
   */
  @Get('logs')
  @Roles(Role.ADMIN, Role.SUPER)
  async logs(
    @Query() query: FindIncidentLogsQueryDto,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') ownCommandCenterId?: string,
  ): Promise<CursorPageResponseDto<IncidentLogEntity>> {
    let commandCenterId: string | undefined;
    if (role === Role.SUPER) {
      commandCenterId = query.command_center_id;
      if (!commandCenterId) {
        throw new BadRequestException('command_center_id is required');
      }
    } else {
      commandCenterId = ownCommandCenterId;
      if (!commandCenterId) {
        throw new ForbiddenException(
          'You are not assigned to a command center',
        );
      }
    }

    const page = await this.incidentService.listIncidentLogs(commandCenterId, {
      limit: query.limit,
      cursor: query.cursor,
    });
    return CursorPageResponseDto.from(page, (log) => log);
  }

  /**
   * One incident: a super, the rider it belongs to, or the responder who
   * claimed it. Responders who were only offered it, and admins of an
   * escalated-to center, are not covered yet (needs a repository lookup).
   */
  @Get(':incidentId')
  @Roles(...ANY_USER)
  async getOne(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<IncidentEntity> {
    const incident = await this.incidentService.getIncident(params.incidentId);
    const allowed =
      role === Role.SUPER ||
      incident.driver_id === userId ||
      incident.claimed_by_id === userId;
    if (!allowed) throw new ForbiddenException('You cannot view this incident');
    return incident;
  }

  // ---------------------------------------------------------------------
  // RESPONDER PROGRESS
  // ---------------------------------------------------------------------

  @Post(':incidentId/claim')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  async claim(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.claimIncident(params.incidentId, userId);
  }

  @Post(':incidentId/en-route')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  async enRoute(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.markEnRoute(params.incidentId, userId);
  }

  /** For 'manual' arrival the confirming user is the caller; for 'gps' nobody. */
  @Post(':incidentId/arrived')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  async standDown(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.standDown(params.incidentId, userId);
  }

  // ---------------------------------------------------------------------
  // PEERS
  // ---------------------------------------------------------------------

  /** A nearby rider answers an alert they were sent. */
  @Post(':incidentId/peer-response')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.DRIVER)
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

  // ---------------------------------------------------------------------
  // VERIFY / RESOLVE
  // ---------------------------------------------------------------------

  @Post(':incidentId/request-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  async requestVerification(
    @Param() params: IncidentIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.requestVerification(params.incidentId, userId);
  }

  @Post(':incidentId/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
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

  // ---------------------------------------------------------------------
  // ASSESSMENT / ESCALATION / CANCEL
  // ---------------------------------------------------------------------

  /** The claimant, an admin or a super. */
  @Patch(':incidentId/threat-level')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
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

  /** The claimant, an admin or a super (the repository enforces which). */
  @Patch(':incidentId/severity')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
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

  /** The claimant, an admin or a super. Returns the escalation id. */
  @Post(':incidentId/escalate')
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
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

  /** The rider cancels their own SOS; an admin or a super can cancel any. */
  @Post(':incidentId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
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

  // ---------------------------------------------------------------------

  /**
   * Admins and supers always pass. A responder passes only for an incident
   * they claimed (one extra read: these routes are rare, so it is fine).
   */
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
