import { SystemAuditLogEntity } from '../interfaces/system-audit-logs-entity.interface';

export type CreateAuditLogInput = Omit<
  SystemAuditLogEntity,
  'id' | 'createdAt'
> & {
  id?: string;
  createdAt?: Date;
};
