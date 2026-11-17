import { ApiProperty } from '@nestjs/swagger';

export class ClipCountResponseDto {
  @ApiProperty({ example: 12 })
  total_clips!: number;

  @ApiProperty({ example: 4 })
  total_incidents!: number;
}

export class ClipItemWithUrlDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ nullable: true })
  view!: string | null;

  @ApiProperty({ nullable: true })
  type!: string | null;

  @ApiProperty({ nullable: true })
  content_type!: string | null;

  @ApiProperty({ nullable: true })
  size_bytes!: number | null;

  @ApiProperty()
  url!: string;
}

export class ClipGroupWithUrlsDto {
  @ApiProperty()
  incident_id!: string;

  @ApiProperty()
  captured_at!: string;

  @ApiProperty()
  trigger_source!: string;

  @ApiProperty()
  threat_type!: string;

  @ApiProperty()
  severity!: string;

  @ApiProperty()
  incident_status!: string;

  @ApiProperty({ type: [ClipItemWithUrlDto] })
  clips!: ClipItemWithUrlDto[];
}
