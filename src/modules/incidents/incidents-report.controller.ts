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
import { IncidentService, ServiceActor } from './incidents.service';
import { IncidentReportEntity } from './interfaces/incident-report-entity.interface';

const ANY_USER = [Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER];

/**
 * Reports are written by responders and reviewed by admins and supers. The
 * caller's id is always `@CurrentUser('sub')`. The service and repository
 * enforce the finer rules (own report, same command center, four-eyes review).
 */
@Controller('incident-reports')
@UseGuards(JwtGuard, RolesGuard)
export class IncidentReportController {
  constructor(private readonly incidentService: IncidentService) {}

  /** A responder opens a draft, or files straight to 'submitted'. */
  @Post()
  @Roles(Role.RESPONDER)
  async create(
    @Body() dto: CreateIncidentReportDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ id: string }> {
    return { id: await this.incidentService.createReport(dto, userId) };
  }

  // Declared before :reportId so "awaiting-review" is not read as an id.
  /** The review queue: an admin's own center, or a super's pick / all. */
  @Get('awaiting-review')
  @Roles(Role.ADMIN, Role.SUPER)
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
  @Roles(...ANY_USER)
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
  @Roles(Role.RESPONDER)
  update(
    @Param() params: ReportIdParamDto,
    @Body() dto: UpdateReportDraftDto,
    @CurrentUser('sub') userId: string,
  ): Promise<IncidentReportEntity> {
    return this.incidentService.updateReportDraft(params.reportId, userId, dto);
  }

  @Post(':reportId/submit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RESPONDER)
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
  async startReview(
    @Param() params: ReportIdParamDto,
    @CurrentUser('sub') userId: string,
  ): Promise<void> {
    await this.incidentService.startReportReview(params.reportId, userId);
  }

  @Post(':reportId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER)
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
