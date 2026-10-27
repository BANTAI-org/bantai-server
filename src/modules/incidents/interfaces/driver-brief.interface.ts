import { BloodTypeEnum } from '../../responders/enums/blood-type.enum';
import { EmergencyContact } from '../../drivers/interfaces/driver-profile.entity';
export type DriverBriefVisibility = 'minimal' | 'full';

/**
 * The responder-facing slice of a driver's profile.
 *
 * `visibility` is the discriminator:
 *   * 'minimal' — only user_id, f_name, l_name are non-null. Shown to a
 *     responder with an OFFERED assignment and to a peer driver who has
 *     only been notified/acknowledged. Enough to know *who* the incident
 *     is about, nothing more.
 *   * 'full' — every field is populated. Shown to the claimant and to a
 *     peer driver whose response status is en_route or on_scene. These are
 *     the only viewers who need blood type, medical conditions, emergency
 *     contacts and vehicle identity to act safely on scene.
 *
 * Callers should key off `visibility` rather than null-checking fields —
 * nulls are the implementation detail, `visibility` is the contract.
 *
 * Deliberately excluded from every tier: email, address, years_riding,
 * service_provider, service_id, fleet_operator_id, phone_verified_at,
 * data_sharing_consented_at. None of those help a responder.
 */
export interface DriverBrief {
  user_id: string;
  f_name: string;
  l_name: string;

  // ---- Only populated when visibility === 'full' ----
  m_name: string | null;
  m_number: string | null;
  avatar_url: string | null;
  blood_type: BloodTypeEnum | null;
  plate_number: string | null;
  /** 'YYYY-MM-DD' — same convention as DriverProfileEntity. */
  date_of_birth: string | null;
  license_number: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  medical_conditions: string | null;
  emergency_contacts: EmergencyContact[] | null;

  visibility: DriverBriefVisibility;
}
