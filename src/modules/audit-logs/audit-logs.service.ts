import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository';
import { CreateAuditLogInput } from './types/create-audit.type';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { GetSingleAuditQueryDto } from './dto/get-single-audit-query.dto';
@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogsRepository: AuditLogsRepository) {}

  async createAudit(input: CreateAuditLogInput): Promise<SystemAuditLogEntity> {
    return this.auditLogsRepository.createAudit(input);
  }

  async getAuditLog(
    commandCenterId: string,
    id: string,
    query?: GetSingleAuditQueryDto,
  ): Promise<SystemAuditLogEntity> {
    const auditLog = await this.auditLogsRepository.get(
      commandCenterId,
      id,
      query?.createdAt,
    );

    if (!auditLog) {
      throw new NotFoundException(
        `Audit log with ID "${id}" not found for Command Center "${commandCenterId}".`,
      );
    }

    return auditLog;
  }

  async getAllAuditLogs(
    commandCenterId: string,
    query: GetAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    return this.auditLogsRepository.getAll({
      commandCenterId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
