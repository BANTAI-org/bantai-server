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
import { TriggerSource } from './enums/trigger-source.enum';
import { IncidentService, ServiceActor } from './incidents.service';
import type { IncidentReportEntity } from './interfaces/incident-report-entity.interface';
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

@Controller('incident-reports')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Incident Reports')
@ApiBearerAuth('access-token')
export class IncidentReportController {
  constructor(private readonly incidentService: IncidentService) {}

  @Post()
  @ApiOperation({ summary: 'Create an incident report' })
  @ApiBody({ type: CreateIncidentReportDto })
  @ApiResponse({ status: 201, description: 'Incident report created' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async create(
    @Body() dto: CreateIncidentReportDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ id: string }> {
    return { id: await this.incidentService.createReport(dto, userId) };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Per-status report counts, scoped and filtered',
    description:
      'Same filters as GET /incident-reports so the badge counts match the visible list.',
  })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'assigned_reporter_id', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'statuses', required: false, isArray: true, type: String })
  @ApiQuery({
    name: 'incident_statuses',
    required: false,
    isArray: true,
    type: String,
  })
  @ApiQuery({
    name: 'trigger_sources',
    required: false,
    isArray: true,
    enum: TriggerSource,
  })
  @ApiQuery({
    name: 'from_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiQuery({
    name: 'to_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiResponse({ status: 200, type: IncidentReportSummaryResponseDto })
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

  @Get()
  @ApiOperation({
    summary: 'List incident reports with offset pagination',
    description:
      'Role-scoped. Filters: status/statuses, incident_statuses, trigger_sources, from_date/to_date (Asia/Manila). Sort by status, dates, or reviewed_at.',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'statuses', required: false, isArray: true, type: String })
  @ApiQuery({
    name: 'incident_statuses',
    required: false,
    isArray: true,
    type: String,
  })
  @ApiQuery({
    name: 'trigger_sources',
    required: false,
    isArray: true,
    enum: TriggerSource,
  })
  @ApiQuery({
    name: 'from_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiQuery({
    name: 'to_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiQuery({ name: 'sort_by', required: false, enum: REPORT_SORT_BY_VALUES })
  @ApiQuery({ name: 'sort_order', required: false, enum: SORT_ORDER_VALUES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({ name: 'assigned_reporter_id', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Offset page of incident reports' })
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

  @Get('awaiting-review')
  @ApiOperation({ summary: 'Cursor queue of reports awaiting review' })
  @ApiQuery({ name: 'command_center_id', required: false, type: String })
  @ApiQuery({
    name: 'trigger_sources',
    required: false,
    isArray: true,
    enum: TriggerSource,
  })
  @ApiQuery({
    name: 'from_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiQuery({
    name: 'to_date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, Asia/Manila',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Review queue returned' })
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

  @Get(':reportId')
  @ApiOperation({ summary: 'Get an incident report by ID' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiResponse({ status: 200, description: 'Incident report returned' })
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

  @Patch(':reportId')
  @ApiOperation({ summary: 'Update an incident report draft' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: UpdateReportDraftDto })
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
  @ApiOperation({ summary: 'Request revisions (a.k.a. reject with reason)' })
  @ApiParam({ name: 'reportId', description: 'Incident report UUID' })
  @ApiBody({ type: RequestReportRevisionDto })
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
