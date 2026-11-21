import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role-enum';
import { CommsService } from './comms.service';
import {
  JoinChannelDto,
  SendMessageDto,
  JoinChannelResponseDto,
  ParticipantDto,
  RadioQueueItemDto,
  CommMessageResponseDto,
  ActiveChannelResponseDto,
  RequestMicDto,
} from './dto/comms.dto';
import { CommMessage } from './interfaces/comms-message.interface';

@ApiTags('Communications')
@ApiBearerAuth('access-token')
@Controller('comms')
@UseGuards(JwtGuard, RolesGuard)
export class CommsController {
  constructor(private readonly commsService: CommsService) {}

  @Get('active')
  @ApiOperation({
    summary: 'Get the current active comms channel for the user',
    description:
      'Used when a user returns to the Comms tab to re-fetch the room state.',
  })
  @ApiResponse({
    status: 200,
    description: 'Active channel returned (or null if none)',
    type: ActiveChannelResponseDto,
  })
  async getActiveChannel(
    @CurrentUser('sub') userId: string,
  ): Promise<ActiveChannelResponseDto | null> {
    return this.commsService.getActiveChannel(userId);
  }

  @Post(':incidentId/join')
  @ApiOperation({
    summary: 'Join a tactical channel and get a RealtimeKit token',
  })
  @ApiParam({
    name: 'incidentId',
    description: 'Incident UUID',
    format: 'uuid',
  })
  @ApiResponse({
    status: 201,
    description: 'Successfully joined channel',
    type: JoinChannelResponseDto,
  })
  async join(
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: JoinChannelDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<JoinChannelResponseDto> {
    return this.commsService.joinChannel(
      incidentId,
      userId,
      role,
      dto.displayName,
    );
  }

  @Get(':channelId/participants')
  @ApiOperation({
    summary: 'View all active participants in the channel',
    description:
      'Returns drivers with their operator details, and responders with their CC details.',
  })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'List of participants',
    type: [ParticipantDto],
  })
  @ApiResponse({ status: 403, description: 'Not a participant' })
  async getParticipants(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<ParticipantDto[]> {
    return this.commsService.getParticipants(channelId, userId);
  }

  @Get(':channelId/radio/queue')
  @ApiOperation({
    summary: 'View the active Push-to-Talk queue',
    description: 'Returns the current speaker and everyone waiting in line.',
  })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'PTT Queue returned',
    type: [RadioQueueItemDto],
  })
  @ApiResponse({ status: 403, description: 'Not a participant' })
  async getQueue(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<RadioQueueItemDto[]> {
    return this.commsService.getRadioQueue(channelId, userId);
  }

  @Post(':channelId/radio/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request the Push-to-Talk microphone',
    description:
      'Victims of HAZARD incidents can request OPEN_MIC for hands-free communication.',
  })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Mic requested (queued or granted)',
  })
  @ApiResponse({
    status: 403,
    description:
      'User does not have permission to speak, or invalid mode used.',
  })
  async requestMic(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: RequestMicDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ status: string }> {
    await this.commsService.requestMic(channelId, userId, role, dto.mode);
    return { status: 'queued' };
  }

  @Post(':channelId/radio/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release the microphone' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Mic released successfully' })
  async releaseMic(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body('queueId', ParseUUIDPipe) queueId: string,
  ): Promise<{ status: string }> {
    await this.commsService.releaseMic(channelId, queueId);
    return { status: 'released' };
  }

  @Post(':channelId/messages')
  @ApiOperation({ summary: 'Send a text message to the channel' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({
    status: 403,
    description: 'User does not have permission to chat',
  })
  async sendMessage(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<CommMessage> {
    return this.commsService.sendMessage(channelId, userId, role, dto.content);
  }

  @Get(':channelId/messages')
  @ApiOperation({ summary: 'Get chat history for a channel' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max messages to return (default 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Message history returned',
    type: [CommMessageResponseDto],
  })
  async getMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('limit') limit?: string,
  ): Promise<CommMessage[]> {
    return this.commsService.getMessageHistory(
      channelId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
