import { IsEnum, NotEquals } from 'class-validator';
import { PeerResponseStatus } from '../enums/peer-response-status.enum';
/**
 * Body for recordPeerResponse. peerDriverId comes from the auth token.
 * 'notified' is the system-set starting state, not something a rider reports,
 * so it is rejected. Peers can never verify or discredit an incident: there is
 * no such status to send.
 */
export class RecordPeerResponseDto {
  @IsEnum(PeerResponseStatus)
  @NotEquals('notified', {
    message: 'status cannot be set back to "notified"',
  })
  status!: PeerResponseStatus;
}
