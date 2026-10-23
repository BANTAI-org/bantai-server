import { AuditAction } from '../enums/audit-action.enum';
export interface SystemAuditLogEntity<
  TOld = Record<string, unknown>,
  TNew = Record<string, unknown>,
> {
  id: string;
  actorId: string | null;
  actorName: string | null;
  commandCenterId: string | null;
  commandCenterName: string | null;
  action: AuditAction;
  targetEntity: string;
  targetId: string;
  oldPayload: TOld | null;
  newPayload: TNew | null;
  createdAt: Date;
}
