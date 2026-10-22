import { CommChannelStatus } from '../enums/comms-channel-status.enum';
export interface CommChannel {
  id: string;
  incident_id: string | null;
  name: string;
  status: CommChannelStatus;
  created_at: Date;
  closed_at: Date | null;
}
