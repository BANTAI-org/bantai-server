import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Standard wrapper for all Cloudflare API responses to ensure type safety.
 */
interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  errors: unknown[];
  messages: unknown[];
}

@Injectable()
export class RealtimeKitService {
  private readonly logger = new Logger(RealtimeKitService.name);
  private readonly accountId: string;
  private readonly appId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.accountId = this.configService.getOrThrow<string>(
      'CLOUDFLARE_ACCOUNT_ID',
    );
    this.appId = this.configService.getOrThrow<string>(
      'CLOUDFLARE_REALTIME_APP_ID',
    );
    this.apiToken = this.configService.getOrThrow<string>(
      'CLOUDFLARE_REALTIME_API_TOKEN',
    );

    // Cloudflare RealtimeKit Base API URL
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/realtime/kit/${this.appId}`;
  }

  /**
   * @description
   * Creates a new audio room (Meeting) in Cloudflare RealtimeKit.
   *
   * @param {string} title - The name of the room (e.g., "Incident 123 - Tactical").
   * @returns {Promise<string>} The unique Cloudflare Meeting ID.
   */
  async createMeeting(title: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });

    // Safely cast the response to our expected structure
    const data = (await response.json()) as CloudflareApiResponse<{
      id: string;
    }>;

    if (!response.ok || !data.success) {
      this.logger.error('Failed to create RealtimeKit meeting', data);
      throw new InternalServerErrorException(
        'Failed to initialize voice channel',
      );
    }

    return data.result.id;
  }

  /**
   * @description
   * Adds a participant to a meeting and generates their unique Auth Token.
   *
   * @param {string} meetingId - The Cloudflare Meeting ID (our comm_channel.id).
   * @param {string} userId - The internal UUID of the user joining.
   * @param {string} userName - The user's callsign or name (e.g., "JOY-0871").
   * @returns {Promise<string>} The RealtimeKit auth token (JWT).
   */
  async generateParticipantToken(
    meetingId: string,
    userId: string,
    userName: string,
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/meetings/${meetingId}/participants`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: userName,
          preset_name: 'voice_preset',
          custom_participant_id: userId,
        }),
      },
    );

    // Safely cast the response to our expected structure
    const data = (await response.json()) as CloudflareApiResponse<{
      token: string;
    }>;

    if (!response.ok || !data.success) {
      this.logger.error(
        `Failed to add participant ${userId} to meeting ${meetingId}`,
        data,
      );
      throw new InternalServerErrorException('Failed to join voice channel');
    }

    return data.result.token;
  }

  /**
   * @description
   * Removes a participant from a meeting.
   *
   * @param {string} meetingId - The Cloudflare Meeting ID.
   * @param {string} participantId - The Cloudflare participant ID.
   * @returns {Promise<void>}
   */
  async removeParticipant(
    meetingId: string,
    participantId: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/meetings/${meetingId}/participants/${participantId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `Failed to remove participant ${participantId} from meeting ${meetingId}`,
      );
    }
  }
}
