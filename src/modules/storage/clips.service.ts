import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClipsRepository } from './clips.repository';
import { S3Service } from './s3.service';
import { ClipCountResponse, ClipGroupWithUrls } from './interfaces/clips.types';
import {
  CursorPage,
  PageOptions,
} from '../../common/utils/cursor-pagination-helper.util';

@Injectable()
export class ClipsService {
  constructor(
    private readonly clipsRepository: ClipsRepository,
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
  ) {}

  async countClips(driverId: string): Promise<ClipCountResponse> {
    return this.clipsRepository.countClips(driverId);
  }

  async findClips(
    driverId: string,
    page: PageOptions = {},
  ): Promise<CursorPage<ClipGroupWithUrls>> {
    const bucket = this.configService.getOrThrow<string>('R2_BUCKET_EVIDENCES');
    const rawPage = await this.clipsRepository.findClips(driverId, page);

    const items: ClipGroupWithUrls[] = await Promise.all(
      rawPage.items.map(async (group) => ({
        ...group,
        clips: await Promise.all(
          group.clips.map(async (clip) => ({
            ...clip,
            url: await this.s3Service.generatePresignedDownloadUrl(
              bucket,
              clip.key,
            ),
          })),
        ),
      })),
    );

    return { items, nextCursor: rawPage.nextCursor };
  }
}
