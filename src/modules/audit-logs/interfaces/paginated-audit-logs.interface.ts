import { SystemAuditLogEntity } from './system-audit-logs-entity.interface';

export interface PaginatedAuditLogs {
  data: SystemAuditLogEntity[];
  nextCursor: string | null;
}
