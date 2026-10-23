import { CommRadioStatus } from '../enums/comms-radio-status.enum';
/**
 * 1:1 with the `comm_radio_queue_view` created in migration 015.
 *
 * This view joins the raw queue with the user_account and r_profile tables
 * so the frontend gets everything it needs to render the "Talk Queue" UI
 * (like the user's name and agency) without needing multiple queries.
 */
export interface CommRadioQueueView {
  queue_id: string;
  channel_id: string;
  status: CommRadioStatus;
  priority: number;
  user_id: string;
  user_name: string;
  responder_agency: string | null;
  requested_at: Date;
}
