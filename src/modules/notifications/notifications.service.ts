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
  /**
   * Polymorphic target discriminator, e.g. 'incident' or 'incident_report'.
   * Must match the value stored by the DB triggers when the same logical
   * event is also written from SQL (see notify_and_audit_report_review).
   */
  relatedEntity?: string;
  relatedEntityId: string;
  /**
   * When true, skip the Postgres insert and only send the FCM push.
   * Set this whenever a database trigger already wrote the notification
   * row for the same logical event:
   *   * report approved / needs_revision   (notify_and_audit_report_review)
   *   * incident escalated                 (incident_after_change)
   *   * incident resolved                  (incident_after_change)
   *   * center-assigned responder notified (handle_center_assignment)
   * The event's title / body / type / relatedEntityId must match the
   * trigger's row exactly, so the push shows the same content the user
   * sees in the inbox.
   */
  skipInbox?: boolean;
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
   *
   * If `event.skipInbox` is true, the DB insert is skipped — the caller
   * has verified that a database trigger already wrote the notification
   * row for this same event. FCM is sent either way.
   */
  @OnEvent('notification.created')
  async handleNotificationCreated(event: NotificationCreatedEvent) {
    const tone = event.tone ?? 'info';

    if (!event.skipInbox) {
      await this.repo.createNotification({
        userId: event.userId,
        type: event.type,
        tone: tone,
        title: event.title,
        body: event.body,
        relatedEntity: event.relatedEntity ?? 'incident',
        relatedEntityId: event.relatedEntityId,
      });
    }

    await this.fcm.sendPushToUser(event.userId, event.title, event.body, {
      type: event.type,
      entityId: event.relatedEntityId,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    });
  }
}
