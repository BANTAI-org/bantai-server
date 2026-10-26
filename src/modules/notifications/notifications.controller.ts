import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post('register-token')
  @ApiOperation({
    summary: 'Register a device FCM token for push notifications',
  })
  @ApiResponse({ status: 201, description: 'Token registered successfully' })
  async registerToken(
    @Body() dto: RegisterDeviceTokenDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    return this.service.registerToken(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get notification history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Notifications returned' })
  async getMyNotifications(
    @CurrentUser('sub') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.getMyNotifications(userId, limit ?? 50);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', description: 'Notification UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    return this.service.markAsRead(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiParam({ name: 'id', description: 'Notification UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Notification deleted successfully',
  })
  async deleteNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    return this.service.deleteNotification(id, userId);
  }
}
