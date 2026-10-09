import { IncidentEvidenceBase } from '../interfaces/incident-evidence.interface';

export type IncidentEvidenceItem = IncidentEvidenceBase &
  ({ key: string; url?: string } | { url: string; key?: string });
