export type IncidentTimelineKind =
  | 'incident_created'
  | 'wave_issued'
  | 'responder_offered'
  | 'responder_claimed'
  | 'responder_en_route'
  | 'responder_arrived'
  | 'incident_escalated'
  | 'verification_completed'
  | 'incident_resolved'
  | 'incident_cancelled'
  | 'report_created'
  | 'report_submitted'
  | 'report_approved'
  | 'report_rejected';

export interface IncidentTimelineEvent {
  /** ISO timestamp. All events are sorted ascending. */
  at: string;
  kind: IncidentTimelineKind;
  /** UUID of the actor, or null for system-generated events. */
  actor_id: string | null;
  /** "First Last" of the actor, or null when actor_id is null. */
  actor_name: string | null;
  /** Kind-specific payload. */
  details: Record<string, unknown>;
}

export interface IncidentTimelineResponse {
  incident_id: string;
  events: IncidentTimelineEvent[];
}
