export interface CommChannel {
  id: string;
  incident_id: string | null;
  name: string;
  status: string;
  created_at: Date;
  closed_at: Date | null;

  // Added via migration 1795464624304_update-naming-convention.sql
  cf_meeting_id: string | null;
}
