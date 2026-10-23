import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class JoinChannelDto {
  @ApiProperty({
    description: 'The incident ID to join the tactical channel for',
  })
  @IsUUID()
  incidentId!: string;

  @ApiProperty({
    description: 'The display name (callsign or name)',
    example: 'JOY-0871',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  displayName!: string;
}

export class SendMessageDto {
  @ApiProperty({
    description: 'The text content of the message',
    example: 'I am 500m away.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  content!: string;
}

export class JoinChannelResponseDto {
  @ApiProperty({
    description:
      'The internal database channel ID (used as the RealtimeKit meeting ID)',
  })
  channelId!: string;

  @ApiProperty({
    description: 'The Cloudflare RealtimeKit Auth Token for WebRTC',
  })
  authToken!: string;
}
