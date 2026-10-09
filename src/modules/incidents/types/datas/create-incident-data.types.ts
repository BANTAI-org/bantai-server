import { IncidentEntity } from '../../interfaces/incident-entity.interface';

export type CreateIncidentData = Pick<
  IncidentEntity,
  | 'driver_id'
  | 'device_id'
  | 'location'
  | 'trigger_source'
  | 'detected_class'
  | 'confidence_level'
  | 'threat_type'
  | 'threat_category'
> &
  Partial<Pick<IncidentEntity, 'evidence' | 'severity'>>;
