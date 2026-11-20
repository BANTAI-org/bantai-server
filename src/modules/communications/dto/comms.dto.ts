import { ApiProperty } from '@nestjs/swagger';

export class JoinChannelDto {
  @ApiProperty({ example: 'JOY-0871' })
  displayName!: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'I am approaching the scene.' })
  content!: string;
}

export class JoinChannelResponseDto {
  @ApiProperty()
  channelId!: string;

  @ApiProperty()
  authToken!: string;
}

export class ParticipantDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'Juan Dela Cruz' })
  name!: string;

  @ApiProperty({ example: 'https://...', nullable: true })
  avatar_url!: string | null;

  @ApiProperty({ enum: ['dispatcher', 'responder', 'peer'] })
  role!: string;

  @ApiProperty({ example: '2026-11-17T08:00:00.000Z' })
  joined_at!: string;

  @ApiProperty({
    example: 'angkas',
    nullable: true,
    description: 'Only for peers',
  })
  service_provider?: string | null;

  @ApiProperty({
    example: 'DRV-12345',
    nullable: true,
    description: 'Only for peers',
  })
  service_id?: string | null;

  @ApiProperty({
    example: 'PCPT',
    nullable: true,
    description: 'Only for responders',
  })
  rank?: string | null;

  @ApiProperty({
    example: 'police',
    nullable: true,
    description: 'Only for responders',
  })
  agency?: string | null;

  @ApiProperty({
    example: 'uuid',
    nullable: true,
    description: 'Only for responders',
  })
  command_center_id?: string | null;

  @ApiProperty({
    example: 'Station 5',
    nullable: true,
    description: 'Only for responders',
  })
  command_center_name?: string | null;
}

export class RadioQueueItemDto {
  @ApiProperty()
  queue_id!: string;

  @ApiProperty()
  user_id!: string;

  @ApiProperty()
  user_name!: string;

  @ApiProperty({ enum: ['requested', 'speaking'] })
  status!: string;

  @ApiProperty()
  priority!: number;

  @ApiProperty({ nullable: true })
  responder_agency!: string | null;

  @ApiProperty()
  requested_at!: string;
}

export class CommMessageResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  channel_id!: string;

  @ApiProperty()
  sender_id!: string;

  @ApiProperty({ enum: ['text', 'system_alert', 'location_share'] })
  type!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  created_at!: string;
}

export class ActiveChannelResponseDto {
  @ApiProperty({ example: 'uuid' })
  channel_id!: string;

  @ApiProperty({ example: 'uuid' })
  incident_id!: string;

  @ApiProperty({ example: 'Incident 8a3f - COLLISION' })
  channel_name!: string;

  @ApiProperty({ example: 'ON_SCENE' })
  incident_status!: string;
}
