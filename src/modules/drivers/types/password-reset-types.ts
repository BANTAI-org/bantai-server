export type ResetIdentityKind = 'id' | 'email' | 'm_number';

export interface ResetIdentity {
  kind: ResetIdentityKind;
  value: string;
}

/** The account facts the reset flow needs. Nothing secret. */
export interface DriverPasswordTarget {
  id: string;
  email: string;
  m_number: string | null;
}
