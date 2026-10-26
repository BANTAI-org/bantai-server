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
  tone?: string;
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
   * Listens for internal domain events, writes to the durable inbox,
   * and triggers the actual FCM push.
   */
  @OnEvent('notification.created')
  async handleNotificationCreated(event: NotificationCreatedEvent) {
    const tone = event.tone ?? 'info';

    // 1. Write to Postgres inbox FIRST so it's never lost
    await this.repo.createNotification({
      userId: event.userId,
      type: event.type,
      tone: tone,
      title: event.title,
      body: event.body,
      relatedEntity: 'incident',
      relatedEntityId: event.relatedEntityId,
    });

    // 2. Send FCM push
    await this.fcm.sendPushToUser(event.userId, event.title, event.body, {
      type: event.type,
      entityId: event.relatedEntityId,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    });
  }
}
