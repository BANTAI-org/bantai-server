import { CommRadioStatus } from './comms-radio-status.enum';
export interface CommRadioQueue {
  id: string;
  channel_id: string;
  user_id: string;
  status: CommRadioStatus;
  /** Higher number = higher priority. Responders get 100, Peers get 10. */
  priority: number;
  requested_at: Date;
  started_speaking_at: Date | null;
  ended_speaking_at: Date | null;
}
