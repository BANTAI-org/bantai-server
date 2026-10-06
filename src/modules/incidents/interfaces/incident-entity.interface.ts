import { GeoPoint } from '../../../common/interfaces/geo-location.interface';
import { ThreatCategoryEnum } from '../enums/threat-category.enum';
import { TriggerSourceEnum } from '../enums/trigger-source.enum';
import { ThreatLevelEnum } from '../enums/threat-level.enum';
import { IncidentStatusEnum } from '../enums/incident-status.enum';
import { IncidentOutcomeEnum } from '../enums/incident-outcome.enum';

export interface IncidentEntity {
  id: string;
  driverId: string | null;
  deviceId: string | null;
  location: GeoPoint;

  triggerSource: TriggerSourceEnum;
  detectedClass: string | null;
  confidenceLevel: number | null;
  snapshotUrls: string[];

  threatCategory: ThreatCategoryEnum;
  threatLevel: ThreatLevelEnum;
  status: IncidentStatusEnum;
  outcome: IncidentOutcomeEnum;

  claimedById: string | null;
  claimedAt: Date | string | null;

  dispatchedAt: Date | string | null;
  onSceneAt: Date | string | null;
  escalatedAt: Date | string | null;
  resolvedAt: Date | string | null;
  cancelledAt: Date | string | null;
  resolvedById: string | null;

  verifiedById: string | null;
  verifiedAt: Date | string | null;
  verificationNotes: string | null;

  createdAt: Date | string;
  updatedAt: Date | string;
}
