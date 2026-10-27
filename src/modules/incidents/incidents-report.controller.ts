import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CreateIncidentReportDto } from './dto/create-incident-report.dto';
import { CursorPageResponseDto } from './dto/cursor-page-response.dto';
import { FindReportsAwaitingReviewQueryDto } from './dto/find-reports-awaiting-review.dto';
import { ReportIdParamDto } from './dto/id-params.dto';
import { UpdateReportDraftDto } from './dto/report-draft.dto';
import { ApproveReportDto } from './dto/approve-report.dto';
import { RequestReportRevisionDto } from './dto/request-report.revision.dto';
import { SubmitIncidentReportDto } from './dto/submit-incident-report.dto';
import {
  IncidentReportSummaryQueryDto,
  IncidentReportSummaryResponseDto,
} from './dto/incident-report-summary.dto';

import {
  ListIncidentReportsQueryDto,
  REPORT_SORT_BY_VALUES,
  SORT_ORDER_VALUES,
} from './dto/list-incident-report-query.dto';
import { IncidentService, ServiceActor } from './incidents.service';
import { IncidentReportEntity } from './interfaces/incident-report-entity.interface';
import { OffsetPageResponseDto } from '../../common/dto/offset-based-pagination.dto';
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

/**
 * Reports are written by responders and reviewed by admins and supers. The
 * caller's id is always `@CurrentUser('sub')`. The service and repository
 * enforce the finer rules (own report, same command center, four-eyes review).
 */
@Controller('incident-reports')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Incident Reports')
@ApiBearerAuth('access-token')
export class IncidentReportController {
  constructor(private readonly incidentService: IncidentService) {}

  /** A responder opens a draft, or files straight to 'submitted'. */
  @Post()
  @ApiOperation({ summary: 'Create an incident report' })
  @ApiBody({ type: CreateIncidentReportDto })
  @ApiResponse({ status: 201, description: 'Incident report created' })
  @ApiResponse({ status: 400, description: 'Invalid report data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async create(
    @Body() dto: CreateIncidentReportDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ id: string }> {
    return { id: await this.incidentService.createReport(dto, userId) };
  }

  // ==================================================================
  // NEW — Summary counts. Must come before @Get(':reportId').
  // ==================================================================
  @Get('summary')
  @ApiOperation({
    summary: 'Get per-status report counts for the caller’s scope',
    description:
      'Responder: only their own. Admin: only their command center. Super: everything, or filtered by command_center_id / assigned_reporter_id.',
  })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'assigned_reporter_id', required: false, type: String })
  @ApiResponse({ status: 200, type: IncidentReportSummaryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(...ANY_USER)
  @ApiRoles(...ANY_USER)
  async summary(
    @Query() query: IncidentReportSummaryQueryDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') commandCenterId?: string,
  ): Promise<IncidentReportSummaryResponseDto> {
    const actor: ServiceActor = {
      id: userId,
      role,
      commandCenterId: commandCenterId ?? null,
    };
    return this.incidentService.getReportSummary(actor, query);
  }

  // ==================================================================
  // NEW — Offset-paginated list. Must come before @Get(':reportId').
  // ==================================================================
  @Get()
  @ApiOperation({
    summary: 'List incident reports with offset pagination',
    description:
      'Role-scoped like /summary. Sortable by status or date. Filter by exact status.',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({
    name: 'sort_by',
    required: false,
    enum: REPORT_SORT_BY_VALUES,
  })
  @ApiQuery({
    name: 'sort_order',
    required: false,
    enum: SORT_ORDER_VALUES,
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'assigned_reporter_id', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Offset page of incident reports',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(...ANY_USER)
  @ApiRoles(...ANY_USER)
  async list(
    @Query() query: ListIncidentReportsQueryDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') commandCenterId?: string,
  ): Promise<OffsetPageResponseDto<IncidentReportEntity>> {
    const actor: ServiceActor = {
      id: userId,
      role,
      commandCenterId: commandCenterId ?? null,
    };
    return this.incidentService.listReports(actor, query);
  }

  // Declared before :reportId so "awaiting-review" is not read as an id.
  /** The review queue: an admin's own center, or a super's pick / all. */
  @Get('awaiting-review')
  @ApiOperation({ summary: 'List reports awaiting review' })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Review queue returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async awaitingReview(
    @Query() query: FindReportsAwaitingReviewQueryDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') commandCenterId?: string,
  ): Promise<CursorPageResponseDto<IncidentReportEntity>> {
    const actor: ServiceActor = {
      id: userId,
      role,
      commandCenterId: commandCenterId ?? null,
    };
    const page = await this.incidentService.listReportsAwaitingReview(
      actor,
      query,
    );
    return CursorPageResponseDto.from(page, (report) => report);
  }

  /** A super, the report's reporter, or an admin of its command center. */
  @Get(':reportId')
  @ApiOperation({ summary: 'Get an incident report by ID' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiResponse({ status: 200, description: 'Incident report returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @Roles(...ANY_USER)
  @ApiRoles(...ANY_USER)
  getOne(
    @Param() params: ReportIdParamDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
    @CurrentUser('command_center_id') commandCenterId?: string,
  ): Promise<IncidentReportEntity> {
    return this.incidentService.getReport(params.reportId, {
      id: userId,
      role,
      commandCenterId: commandCenterId ?? null,
    });
  }

  /** The reporter edits a draft or a report sent back for revision. */
  @Patch(':reportId')
  @ApiOperation({ summary: 'Update an incident report draft' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: UpdateReportDraftDto })
  @ApiResponse({ status: 200, description: 'Incident report updated' })
  @ApiResponse({ status: 400, description: 'Invalid report data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  update(
    @Param() params: ReportIdParamDto,
    @Body() dto: UpdateReportDraftDto,
    @CurrentUser('sub') userId: string,
  ): Promise<IncidentReportEntity> {
    return this.incidentService.updateReportDraft(params.reportId, userId, dto);
  }

  @Post(':reportId/submit')
  @ApiOperation({ summary: 'Submit an incident report' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: SubmitIncidentReportDto })
  @ApiResponse({ status: 204, description: 'Incident report submitted' })
  @ApiResponse({ status: 400, description: 'Invalid submission' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async submit(
    @Param() params: ReportIdParamDto,
    @Body() dto: SubmitIncidentReportDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.submitReport(
      params.reportId,
      userId,
      dto.disposition,
    );
  }

  @Post(':reportId/start-review')
  @ApiOperation({ summary: 'Start reviewing an incident report' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiResponse({ status: 204, description: 'Review started' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async startReview(
    @Param() params: ReportIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.startReportReview(params.reportId, userId);
  }

  @Post(':reportId/approve')
  @ApiOperation({ summary: 'Approve an incident report' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: ApproveReportDto })
  @ApiResponse({ status: 204, description: 'Incident report approved' })
  @ApiResponse({ status: 400, description: 'Invalid approval data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async approve(
    @Param() params: ReportIdParamDto,
    @Body() dto: ApproveReportDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.approveReport(
      params.reportId,
      userId,
      dto.notes,
    );
  }

  @Post(':reportId/request-revision')
  @ApiOperation({ summary: 'Request revisions to an incident report' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: RequestReportRevisionDto })
  @ApiResponse({ status: 204, description: 'Revision requested' })
  @ApiResponse({ status: 400, description: 'Invalid revision request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async requestRevision(
    @Param() params: ReportIdParamDto,
    @Body() dto: RequestReportRevisionDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.requestReportRevision(
      params.reportId,
      userId,
      dto.notes,
    );
  }
}
