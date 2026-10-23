import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly repo: NotificationsRepository,
  ) {}

  onModuleInit() {
    // Check if Firebase is already initialized to prevent hot-reload errors
    if (getApps().length === 0) {
      try {
        initializeApp({
          credential: cert({
            projectId: this.configService.getOrThrow<string>('FCM_PROJECT_ID'),
            clientEmail:
              this.configService.getOrThrow<string>('FCM_CLIENT_EMAIL'),
            // Replace literal \n with actual newlines
            privateKey: this.configService
              .getOrThrow<string>('FCM_PRIVATE_KEY')
              .replace(/\\n/g, '\n'),
          }),
        });
        this.logger.log('Firebase Admin initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize Firebase Admin', error);
      }
    }
  }

  /**
   * Sends a push notification to all devices belonging to a user.
   */
  async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    dataPayload: Record<string, string>,
  ): Promise<void> {
    const tokens = await this.repo.getUserTokens(userId);
    if (tokens.length === 0) {
      this.logger.debug(`No FCM tokens found for user ${userId}`);
      return;
    }

    const message: MulticastMessage = {
      tokens,
      notification: { title, body },
      data: dataPayload,
      android: {
        priority: 'high',
        notification: { channelId: 'high_importance_channel' },
      },
      apns: {
        payload: { aps: { sound: 'default', contentAvailable: true } },
      },
    };

    try {
      // Get the messaging instance using the modular API
      const messaging = getMessaging();
      const response = await messaging.sendEachForMulticast(message);

      this.logger.log(
        `Sent FCM: ${response.successCount} success, ${response.failureCount} failed`,
      );

      // Cleanup invalid tokens
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token'
            ) {
              failedTokens.push(tokens[idx]);
            }
          }
        });

        if (failedTokens.length > 0) {
          this.logger.warn(
            `Removing ${failedTokens.length} invalid FCM tokens`,
          );
          await this.repo.removeTokens(failedTokens);
        }
      }
    } catch (error) {
      this.logger.error('Error sending FCM multicast', error);
    }
  }
}
