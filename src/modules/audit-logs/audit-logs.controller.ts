import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { GetSingleAuditQueryDto } from './dto/get-single-audit-query.dto';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('command-centers/:commandCenterId/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER)
  async getAll(
    @CurrentUser('sub') userId: string,
    @Query() query: GetAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    return this.auditLogsService.getAllAuditLogs(userId, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER)
  async getOne(
    @Param('commandCenterId', ParseUUIDPipe) commandCenterId: string,
    @Query() query: GetSingleAuditQueryDto,
    @CurrentUser('sub') userId: string,
  ): Promise<SystemAuditLogEntity> {
    return this.auditLogsService.getAuditLog(userId, query);
  }
}
