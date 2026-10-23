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
} from './dto/comms.dto';
import { CommMessage } from './interfaces/comms-message.interface';

@ApiTags('Communications')
@ApiBearerAuth('access-token')
@Controller('comms')
@UseGuards(JwtGuard, RolesGuard)
export class CommsController {
  constructor(private readonly commsService: CommsService) {}

  /**
   * @description
   * Joins the tactical channel for a specific incident.
   * Validates the user, registers them in the database, and returns
   * a Cloudflare RealtimeKit token for the WebRTC voice connection.
   */
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
  @ApiResponse({
    status: 404,
    description: 'Channel not found for this incident',
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

  /**
   * @description
   * Request the Push-to-Talk microphone.
   * If the channel is silent, the user is immediately granted the mic.
   * If someone is speaking, the user is added to the priority queue.
   */
  @Post(':channelId/radio/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request the Push-to-Talk microphone' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Mic requested (queued or granted)',
  })
  async requestMic(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ status: string }> {
    await this.commsService.requestMic(channelId, userId, role);
    return { status: 'queued' };
  }

  /**
   * @description
   * Release the Push-to-Talk microphone.
   * Marks the current speaker as done and automatically grants the mic
   * to the next highest-priority person in the queue.
   */
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

  /**
   * @description
   * Send a text message to the channel.
   * Saves the message to Postgres and broadcasts it via WebSockets.
   */
  @Post(':channelId/messages')
  @ApiOperation({ summary: 'Send a text message to the channel' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  async sendMessage(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
  ): Promise<CommMessage> {
    return this.commsService.sendMessage(channelId, userId, dto.content);
  }

  /**
   * @description
   * Get the chat history for a channel.
   * Returns the most recent messages, ordered newest to oldest.
   */
  @Get(':channelId/messages')
  @ApiOperation({ summary: 'Get chat history for a channel' })
  @ApiParam({ name: 'channelId', description: 'Channel UUID', format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max messages to return (default 50)',
  })
  @ApiResponse({ status: 200, description: 'Message history returned' })
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
