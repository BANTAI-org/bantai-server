/** Postgres: incident_disposition_enum. Required once a report is past draft. */
export enum IncidentDisposition {
  TREATED_ON_SCENE_REFUSED_TRANSPORT = 'treated_on_scene_refused_transport',
  SCENE_SECURED_BY_POLICE = 'scene_secured_by_police',
  VEHICLE_TOWED_TRAFFIC_CLEARED = 'vehicle_towed_traffic_cleared',
  HANDLED_BY_BARANGAY = 'handled_by_barangay',
  FALSE_ALARM = 'false_alarm',
}
