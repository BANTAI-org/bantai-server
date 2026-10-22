import { CommParticipantRole } from '../enums/comms-participant-role.enum';
export interface CommParticipant {
  channel_id: string;
  user_id: string;
  role: CommParticipantRole;
  joined_at: Date;
  left_at: Date | null;
}
