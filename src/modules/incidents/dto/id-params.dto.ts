import { IsString } from 'class-validator';

export class IncidentIdParamDto {
  @IsString()
  incidentId!: string;
}

export class ReportIdParamDto {
  @IsString()
  reportId!: string;
}
