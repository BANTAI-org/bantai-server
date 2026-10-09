export interface IncidentEvidenceBase {
  /** Which camera / angle, for dashcam clips. */
  view?: 'front' | 'rear' | (string & {});
  type?: 'video' | 'image' | 'audio' | (string & {});
  content_type?: string;
  size_bytes?: number;
  duration_s?: number;
  /** ISO-8601, set when the upload was confirmed. */
  uploaded_at?: string;
  /** The JSONB column accepts any additional reference fields. */
  [extra: string]: unknown;
}
