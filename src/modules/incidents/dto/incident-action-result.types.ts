/**
 * Results of incident actions that can fail for more than one reason, so the
 * service can answer 404 / 403 / 409 / 422 instead of a bare "false".
 */

/**
 *  verified         done
 *  not_found        no such incident
 *  forbidden        verifier is not a responder, admin or super
 *  own_claim        the verifier is the responder who claimed it
 *  not_verifiable   not awaiting verification, or already verified
 */
export type VerifyResult =
  'verified' | 'not_found' | 'forbidden' | 'own_claim' | 'not_verifiable';

/**
 *  resolved             done
 *  not_found            no such incident
 *  forbidden            resolver is neither the claimant nor an admin/super
 *  not_resolvable       not ON_SCENE / AWAITING_VERIFICATION / ESCALATED
 *  invalid_outcome      'unresolved' cannot close an incident
 *  needs_verification   HAZARD (or an unresolved DE_ESCALATABLE) incident that
 *                       has not been verified by a second person yet
 */
export type ResolveResult =
  | 'resolved'
  | 'not_found'
  | 'forbidden'
  | 'not_resolvable'
  | 'invalid_outcome'
  | 'needs_verification';

/**
 *  updated     done
 *  unchanged   already at that severity (not an error, nothing to announce)
 *  not_found   no such incident
 *  forbidden   updater is neither the claimant nor an admin/super
 *  closed      the incident is RESOLVED or CANCELLED
 */
export type UpdateSeverityResult =
  'updated' | 'unchanged' | 'not_found' | 'forbidden' | 'closed';

export interface UpdateSeverityOutcome {
  result: UpdateSeverityResult;
  /** Peers who were en route / on scene and were stood down by this change. */
  standDownPeerIds: string[];
}
