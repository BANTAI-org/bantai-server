import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { S3Service } from './s3.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import {
  InitiateMultipartDto,
  SignPartsDto,
  CompleteMultipartDto,
} from './dto/multipart-evidence.dto';

// Allowlist of safe extensions for profile images and evidence
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const ALLOWED_EVIDENCE_EXTENSIONS = [
  'mp4',
  'mov',
  'webm',
  'jpg',
  'jpeg',
  'png',
];

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
@UseGuards(JwtGuard, RolesGuard)
export class StorageController {
  constructor(
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
  ) {}

  @Post('profile-image/upload-url')
  @Roles(Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiOperation({ summary: 'Get a presigned URL to upload a profile image' })
  @ApiBody({ type: RequestUploadUrlDto })
  @ApiResponse({
    status: 201,
    description: 'Returns the upload URL and object key',
  })
  @ApiResponse({ status: 400, description: 'Invalid image upload request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfileImageUploadUrl(
    @Body() dto: RequestUploadUrlDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    // Extract and validate extension safely
    const rawExtension = dto.contentType.split('/')[1]?.toLowerCase() || '';
    const extension = rawExtension.split('+')[0]; // handle image/svg+xml

    if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        `Invalid image type. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`,
      );
    }

    const key = `users/${userId}/avatar.${extension}`;
    const bucket = this.configService.getOrThrow<string>(
      'R2_BUCKET_PROFILE_IMAGES',
    );

    const url = await this.s3Service.generatePresignedUploadUrl(
      bucket,
      key,
      dto.contentType,
      dto.fileSize,
    );
    return { uploadUrl: url, objectKey: key };
  }

  @Post('evidence/multipart/initiate')
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiOperation({
    summary: 'Step 1: Initiate a multipart upload for large videos',
  })
  @ApiBody({ type: InitiateMultipartDto })
  @ApiQuery({
    name: 'incidentId',
    required: false,
    description: 'Link the video to an incident',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the uploadId and objectKey',
  })
  @ApiResponse({ status: 400, description: 'Invalid upload request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async initiateEvidenceUpload(
    @Body() dto: InitiateMultipartDto,
    @CurrentUser('sub') userId: string,
    @Query('incidentId') incidentId?: string,
  ): Promise<{ uploadId: string; objectKey: string }> {
    // Extract and validate extension safely
    const extension = dto.fileName.split('.').pop()?.toLowerCase() || 'mp4';
    if (!ALLOWED_EVIDENCE_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        `Invalid evidence file type. Allowed: ${ALLOWED_EVIDENCE_EXTENSIONS.join(', ')}`,
      );
    }

    const key = incidentId
      ? `incidents/${incidentId}/evidence_${userId}_${Date.now()}.${extension}`
      : `unlinked/${userId}/evidence_${userId}_${Date.now()}.${extension}`;

    const bucket = this.configService.getOrThrow<string>('R2_BUCKET_EVIDENCES');
    const uploadId = await this.s3Service.createMultipartUpload(
      bucket,
      key,
      dto.contentType,
    );
    return { uploadId, objectKey: key };
  }

  @Post('evidence/multipart/sign-parts')
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiOperation({ summary: 'Step 2: Get presigned URLs for the video chunks' })
  @ApiBody({ type: SignPartsDto })
  @ApiResponse({
    status: 201,
    description: 'Returns an array of part numbers and their presigned URLs',
  })
  @ApiResponse({ status: 400, description: 'Invalid multipart upload request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async signEvidenceParts(
    @Body() dto: SignPartsDto,
  ): Promise<{ urls: { partNumber: number; url: string }[] }> {
    const bucket = this.configService.getOrThrow<string>('R2_BUCKET_EVIDENCES');
    const urls = await this.s3Service.generatePresignedPartUrls(
      bucket,
      dto.key,
      dto.uploadId,
      dto.partNumbers,
    );
    return { urls };
  }

  @Post('evidence/multipart/complete')
  @Roles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.ADMIN, Role.SUPER)
  @ApiOperation({ summary: 'Step 3: Complete the upload by sending the ETags' })
  @ApiBody({ type: CompleteMultipartDto })
  @ApiResponse({
    status: 201,
    description: 'Successfully merged all chunks into one video file',
  })
  @ApiResponse({ status: 400, description: 'Invalid multipart upload request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async completeEvidenceUpload(
    @Body() dto: CompleteMultipartDto,
  ): Promise<{ objectKey: string; success: boolean }> {
    const bucket = this.configService.getOrThrow<string>('R2_BUCKET_EVIDENCES');
    await this.s3Service.completeMultipartUpload(
      bucket,
      dto.key,
      dto.uploadId,
      dto.parts,
    );
    return { objectKey: dto.key, success: true };
  }

  @Get('download-url')
  @Roles(Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.DRIVER, Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiOperation({ summary: 'Get a presigned URL to view an image or video' })
  @ApiQuery({ name: 'key', required: true, description: 'The R2 object key' })
  @ApiQuery({ name: 'bucket', required: true, enum: ['profile', 'evidence'] })
  @ApiResponse({ status: 200, description: 'Returns the secure download URL' })
  @ApiResponse({ status: 400, description: 'Invalid bucket or object key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDownloadUrl(
    @Query('key') key: string,
    @Query('bucket') bucketType: 'profile' | 'evidence',
  ): Promise<{ downloadUrl: string }> {
    // Basic validation to prevent path traversal
    if (key.includes('..')) {
      throw new BadRequestException('Invalid object key');
    }

    let bucketName: string;
    if (bucketType === 'evidence') {
      bucketName = this.configService.getOrThrow<string>('R2_BUCKET_EVIDENCES');
    } else if (bucketType === 'profile') {
      bucketName = this.configService.getOrThrow<string>(
        'R2_BUCKET_PROFILE_IMAGES',
      );
    } else {
      throw new BadRequestException(
        'Invalid bucket specified. Use "profile" or "evidence".',
      );
    }

    // TODO: In V2, verify that the caller is actually authorized to view
    // the incident referenced in the key (e.g. `incidents/<id>/...`).
    // For now, users must be authenticated to get the presigned URL.

    const url = await this.s3Service.generatePresignedDownloadUrl(
      bucketName,
      key,
    );
    return { downloadUrl: url };
  }
}
