import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IncidentReportSummaryQueryDto {
  @ApiProperty({
    required: false,
    description:
      'Command center UUID. Only honored for super; admin is scoped to own; responder is scoped to self.',
  })
  @IsOptional()
  @IsUUID()
  command_center_id?: string;

  @ApiProperty({
    required: false,
    description:
      'Reporter UUID. Honored for admins (own CC only) and supers. Ignored for responders.',
  })
  @IsOptional()
  @IsUUID()
  assigned_reporter_id?: string;
}

export class IncidentReportSummaryResponseDto {
  @ApiProperty({ description: 'Total reports in the caller’s scope' })
  total!: number;

  // Per-status counts
  @ApiProperty({ description: 'Draft — not yet submitted' })
  draft!: number;
  @ApiProperty({ description: 'Submitted — awaiting a reviewer' })
  submitted!: number;
  @ApiProperty({ description: 'Under review — reviewer already picked it up' })
  under_review!: number;
  @ApiProperty({
    description: 'Needs revision — reporter must fix and resubmit',
  })
  needs_revision!: number;
  @ApiProperty({ description: 'Approved — final' })
  approved!: number;

  // Aggregated views
  @ApiProperty({
    description:
      'Reports actively awaiting a reviewer = submitted + under_review',
  })
  pending_review!: number;

  @ApiProperty({
    description:
      'Reports not yet verified = submitted + under_review (same set as pending_review, aliased for the “yet to be verified” UI copy)',
  })
  awaiting_verification!: number;

  @ApiProperty({
    description: 'Reports where the reporter must act = needs_revision',
  })
  request_revision!: number;

  @ApiProperty({
    description: 'Reports not yet submitted = draft',
  })
  awaiting_submission!: number;
}
