/**
 * peer_response_status. Nearby riders can acknowledge and offer help;
 * they can never verify or discredit an incident, so there is
 * deliberately no verdict value here.
 */
export enum PeerResponseStatusEnum {
  NOTIFIED = 'notified',
  ACKNOWLEDGED = 'acknowledged',
  EN_ROUTE = 'en_route',
  ON_SCENE = 'on_scene',
  STOOD_DOWN = 'stood_down',
}
