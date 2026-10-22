import { CommMessageType } from '../enums/comms-message-type.enum';

export interface CommMessage {
  id: string;
  channel_id: string;
  sender_id: string | null;
  type: CommMessageType;
  content: string;
  created_at: Date;
}
