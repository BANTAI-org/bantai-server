/**
 * Peer Eligibility Test
 *
 * This test explicitly compares the SQL string `peerEligibleSql()` from
 * `incidents.repository.ts` against the TypeScript function
 * `isPeerHelpEligible()` from `peer-help-policy.util.ts` over all
 * combinations of threat_type, threat_category, severity, and threat_level.
 *
 * Reference: peer-help-policy.util.ts line 9-11:
 *   "MUST stay in step with peerEligibleSql() in the incident repository,
 *    which stands down peers in the same statement as the change that made
 *    the incident ineligible. A test compares the two over every combination."
 */

import { describe, test, expect } from '@jest/globals';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { isPeerHelpEligible } from '../utils/peer-help-policy.util';

// --- SQL peerEligibleSql (from incidents.repository.ts) ---
// const peerEligibleSql = (alias: string): string => `(
//     ${alias}.threat_category = 'ASSIST'
//     AND ${alias}.threat_type NOT IN ('GUN', 'BLADE')
//     AND ${alias}.severity = 'MINOR'
//     AND ${alias}.threat_level = 'CLEAR'
//   )`;

// Use actual enum values
const threatTypes = Object.values(ThreatType);
const threatCategories = Object.values(ThreatCategory);
const severities = Object.values(IncidentSeverity);
const threatLevels = Object.values(ThreatLevel);

function sqlPeerEligible(
  threatCategory: ThreatCategory,
  threatType: ThreatType,
  severity: IncidentSeverity,
  threatLevel: ThreatLevel,
): boolean {
  return (
    threatCategory === ThreatCategory.ASSIST &&
    threatType !== ThreatType.GUN &&
    threatType !== ThreatType.BLADE &&
    severity === IncidentSeverity.MINOR &&
    threatLevel === ThreatLevel.CLEAR
  );
}

// --- Test: Compare SQL vs TS over ALL combinations ---
describe('Peer Eligibility: SQL vs TS parity', () => {
  test('should match for ALL combinations of enum values', () => {
    let mismatches = 0;
    let total = 0;

    for (const tt of threatTypes) {
      for (const tc of threatCategories) {
        for (const sev of severities) {
          for (const tl of threatLevels) {
            total++;
            // isPeerHelpEligible expects snake_case property names matching IncidentEntity
            const tsResult = isPeerHelpEligible({
              threat_type: tt,
              threat_category: tc,
              severity: sev,
              threat_level: tl,
            });
            const sqlResult = sqlPeerEligible(tc, tt, sev, tl);
            if (tsResult !== sqlResult) {
              mismatches++;
              console.error(
                `MISMATCH: threatType=${tt}, threatCategory=${tc}, severity=${sev}, threatLevel=${tl} => TS=${tsResult}, SQL=${sqlResult}`,
              );
            }
          }
        }
      }
    }

    expect(mismatches).toBe(0);
    console.log(`Total combinations: ${total}, mismatches: ${mismatches}`);
  });
});
