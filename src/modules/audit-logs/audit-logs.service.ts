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

/** Anchors date-only bounds to UTC start/end of day. */
function normalizeBound(
  value: string | undefined,
  bound: 'from' | 'to',
): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return bound === 'from'
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  }
  return value;
}

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

    const from = normalizeBound(query.from, 'from');
    const to = normalizeBound(query.to, 'to');

    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new BadRequestException('from must be <= to');
    }

    return this.auditLogsRepository.getAll({
      commandCenterId,
      limit: query.limit,
      cursor: query.cursor,
      action: query.action,
      category: query.category,
      actorId: query.actorId,
      from,
      to,
    });
  }

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
