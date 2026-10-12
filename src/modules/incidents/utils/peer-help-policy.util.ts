import { IncidentEntity } from '../interfaces/incident-entity.interface';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { PeerResponseStatus } from '../enums/peer-response-status.enum';

/**
 * MUST stay in step with peerEligibleSql() in the incident repository, which
 * stands down peers in the same statement as the change that made the incident
 * ineligible. A test compares the two over every combination.
 */
export function isPeerHelpEligible(
  incident: Pick<
    IncidentEntity,
    'threat_type' | 'threat_category' | 'severity' | 'threat_level'
  >,
): boolean {
  const isWeapon =
    incident.threat_type === ThreatType.GUN ||
    incident.threat_type === ThreatType.BLADE;
  return (
    !isWeapon &&
    incident.threat_category === ThreatCategory.ASSIST &&
    incident.severity === IncidentSeverity.MINOR &&
    incident.threat_level === ThreatLevel.CLEAR
  );
}

/** Heading to the scene or being there, as opposed to just seeing the alert. */
export function isPhysicalPeerResponse(status: PeerResponseStatus): boolean {
  const value: string = status;
  return value === 'en_route' || value === 'on_scene';
}
