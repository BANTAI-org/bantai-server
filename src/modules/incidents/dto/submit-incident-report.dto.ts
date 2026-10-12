import { IsEnum, IsOptional } from 'class-validator';
import { IncidentDisposition } from '../enums/incident-disposition.enum';
/**
 * Body for submitReport (first submission or resubmission after a revision
 * request). submitterId comes from the auth token. Send a disposition here if
 * the draft does not have one yet; the database rejects a submission with none
 * (23514), which the service should map to 400.
 */
export class SubmitIncidentReportDto {
  @IsOptional()
  @IsEnum(IncidentDisposition)
  disposition?: IncidentDisposition | null;
}
