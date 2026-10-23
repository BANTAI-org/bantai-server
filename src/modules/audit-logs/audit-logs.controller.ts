import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { GetSingleAuditQueryDto } from './dto/get-single-audit-query.dto';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('/audit-logs')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  // GET /audit-logs
  // - super: must pass ?commandCenterId=<uuid>
  // - admin: scope comes from their JWT
  @Get()
  @ApiOperation({ summary: 'List audit logs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'commandCenterId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Audit log page returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async getAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    return this.auditLogsService.getAllAuditLogs(user, query);
  }

  // GET /audit-logs/:id   (id = audit log UUID)
  // - super: must pass ?commandCenterId=<uuid>
  // - admin: scope comes from their JWT
  @Get(':id')
  @ApiOperation({ summary: 'Get an audit log by ID' })
  @ApiParam({ name: 'id', description: 'Audit log UUID' })
  @ApiQuery({ name: 'createdAt', required: false, type: String })
  @ApiQuery({ name: 'commandCenterId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Audit log returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Audit log not found' })
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async getOne(
    @Param('id', ParseUUIDPipe) auditId: string,
    @Query() query: GetSingleAuditQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SystemAuditLogEntity> {
    return this.auditLogsService.getAuditLog(auditId, user, query);
  }
}
