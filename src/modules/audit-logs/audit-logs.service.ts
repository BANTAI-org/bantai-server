import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository';
import { CreateAuditLogInput } from './types/create-audit.type';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { GetSingleAuditQueryDto } from './dto/get-single-audit-query.dto';
import { Role } from '../../common/enums/role-enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly auditLogsRepository: AuditLogsRepository) {}

  async createAudit(input: CreateAuditLogInput): Promise<SystemAuditLogEntity> {
    return this.auditLogsRepository.createAudit(input);
  }

  async getAuditLog(
    auditId: string,
    user: AuthenticatedUser,
    query?: GetSingleAuditQueryDto,
  ): Promise<SystemAuditLogEntity> {
    const commandCenterId = await this.resolveCommandCenterId(
      user,
      query?.commandCenterId,
    );

    const auditLog = await this.auditLogsRepository.get(
      commandCenterId,
      auditId,
      query?.createdAt,
    );

    // Same 404 whether the log doesn't exist or belongs to another
    // command center, so IDs outside the caller's scope can't be probed.
    if (!auditLog) {
      throw new NotFoundException(`Audit log "${auditId}" not found.`);
    }

    return auditLog;
  }

  async getAllAuditLogs(
    user: AuthenticatedUser,
    query: GetAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    const commandCenterId = await this.resolveCommandCenterId(
      user,
      query.commandCenterId,
    );

    return this.auditLogsRepository.getAll({
      commandCenterId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /**
   * Super users have no fixed command center, so it must be supplied in the
   * request (and is validated). Everyone else is locked to the command center
   * in their JWT; any value they send in the query is ignored.
   */
  private async resolveCommandCenterId(
    user: AuthenticatedUser,
    requested?: string,
  ): Promise<string> {
    if (user.role === Role.SUPER) {
      if (!requested) {
        throw new BadRequestException(
          'commandCenterId is required for super users.',
        );
      }

      const existing =
        await this.auditLogsRepository.getCommandCenterIdOnId(requested);

      if (!existing) {
        throw new NotFoundException(`Command center "${requested}" not found.`);
      }

      return existing;
    }

    if (!user.command_center_id) {
      this.logger.warn(
        `User ${user.sub} (role: ${user.role}) has no command_center_id in token.`,
      );
      throw new ForbiddenException('No command center assigned to this user.');
    }

    return user.command_center_id;
  }
}
