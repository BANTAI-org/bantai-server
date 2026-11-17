export interface ClipItem {
  key: string;
  view: string | null;
  type: string | null;
  content_type: string | null;
  size_bytes: number | null;
}

export interface ClipItemWithUrl extends ClipItem {
  url: string;
}

export interface ClipGroup {
  incident_id: string;
  captured_at: string;
  trigger_source: string;
  threat_type: string;
  severity: string;
  incident_status: string;
  clips: ClipItem[];
}

export interface ClipGroupWithUrls extends Omit<ClipGroup, 'clips'> {
  clips: ClipItemWithUrl[];
}

export interface ClipCountResponse {
  total_clips: number;
  total_incidents: number;
}
