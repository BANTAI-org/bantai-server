import { IncidentEntity } from '../interfaces/incident-entity.interface';

export type CreateIncidentData = Pick<
  IncidentEntity,
  | 'driverId'
  | 'deviceId'
  | 'location'
  | 'triggerSource'
  | 'detectedClass'
  | 'confidenceLevel'
  | 'snapshotUrls'
  | 'threatCategory'
  | 'threatLevel'
>;
