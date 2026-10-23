import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsRepository } from './notifications.repository';
import { FcmService } from './fcm.service';
import { RegisterDeviceTokenDto } from './dto/notification.dto';

export interface NotificationCreatedEvent {
  userId: string;
  title: string;
  body: string;
  type: string;
  relatedEntityId: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly fcm: FcmService,
  ) {}

  async registerToken(userId: string, dto: RegisterDeviceTokenDto) {
    await this.repo.registerToken(userId, dto.fcmToken, dto.deviceType);
    return { success: true };
  }

  async getMyNotifications(userId: string, limit?: number) {
    return this.repo.getNotifications(userId, limit);
  }

  async markAsRead(notificationId: string, userId: string) {
    const success = await this.repo.markAsRead(notificationId, userId);
    if (!success) {
      throw new NotFoundException('Notification not found or already read');
    }
    return { success: true };
  }

  async deleteNotification(notificationId: string, userId: string) {
    const success = await this.repo.deleteNotification(notificationId, userId);
    if (!success) {
      throw new NotFoundException('Notification not found');
    }
    return { success: true };
  }

  /**
   * Listens for internal domain events and triggers the actual FCM push.
   * Emit this from anywhere in your app: this.events.emit('notification.created', payload)
   */
  @OnEvent('notification.created')
  async handleNotificationCreated(event: NotificationCreatedEvent) {
    await this.fcm.sendPushToUser(event.userId, event.title, event.body, {
      type: event.type,
      entityId: event.relatedEntityId,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    });
  }
}
