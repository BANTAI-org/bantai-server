import { AuditAction } from '../enums/audit-action.enum';

export interface GetAuditLogsParams {
  commandCenterId: string;
  limit?: number;
  cursor?: string;
  action?: AuditAction[];
  category?: string[];
  actorId?: string;
  from?: string;
  to?: string;
}
