import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * @description
 * Service for interacting with Cloudflare R2 (which is S3-compatible).
 * Handles generating Presigned URLs for secure, direct client-to-R2 uploads
 * and downloads, bypassing our NestJS server for the actual file transfer.
 *
 * Supports two main upload flows:
 * 1. Single PUT Upload: Used for small files like profile images (< 5MB).
 * 2. Multipart Upload: Used for large files like evidence videos (> 100MB)
 *    to allow chunking, retries, and resumability.
 */
@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto', // Required for Cloudflare R2
      endpoint: `https://${this.configService.getOrThrow<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'R2_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  /**
   * @description
   * Generates a Presigned PUT URL for a single-file upload.
   * The client should use this URL to PUT the file directly to R2.
   *
   * NOTE: We intentionally OMIT ContentLength from the command. Including it
   * forces the signature to strictly match the exact byte size. If a client
   * (Flutter, Thunder Client, browser) compresses the file or formats the
   * body differently, R2 will reject it with a SignatureDoesNotMatch.
   * By omitting it, R2 will accept the file regardless of its size.
   *
   * @param {string} bucket - The name of the R2 bucket.
   * @param {string} key - The exact object key/path.
   * @param {string} contentType - The MIME type (e.g., 'image/jpeg').
   * @param {number} contentLength - The file size in bytes (unused for signing, kept for API compatibility).
   * @param {number} [expiresInSeconds=900] - URL validity duration (default 15 mins).
   * @returns {Promise<string>} The presigned PUT URL.
   */
  async generatePresignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    contentLength: number, // Kept in signature so we don't break the Controller
    expiresInSeconds = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      // ContentLength: contentLength, <-- REMOVED: This was causing the SignatureDoesNotMatch
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * @description
   * Step 1 of 4 in a Multipart Upload. Initiates the upload session on R2.
   *
   * @param {string} bucket - The R2 bucket name (e.g., 'bantai-evidences').
   * @param {string} key - The object key (e.g., 'incidents/123/front_cam.mp4').
   * @param {string} contentType - The MIME type (e.g., 'video/mp4').
   * @returns {Promise<string>} The unique `uploadId` required for signing and completing the parts.
   * @throws {Error} If R2 fails to generate an UploadId.
   */
  async createMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const response = await this.s3Client.send(command);
    if (!response.UploadId)
      throw new Error('Failed to initiate multipart upload');
    return response.UploadId;
  }

  /**
   * @description
   * Step 2 of 4 in a Multipart Upload. Generates Presigned URLs for specific
   * chunks/parts of the video. The client uploads each chunk to its respective URL.
   *
   * @param {string} bucket - The R2 bucket name.
   * @param {string} key - The object key.
   * @param {string} uploadId - The ID returned from `createMultipartUpload`.
   * @param {number[]} partNumbers - An array of part numbers to sign (e.g., [1, 2, 3]).
   * @param {number} [expiresInSeconds=3600] - URL validity duration (default 1 hour).
   * @returns {Promise<{ partNumber: number; url: string }[]>} An array of part numbers and their presigned PUT URLs.
   */
  async generatePresignedPartUrls(
    bucket: string,
    key: string,
    uploadId: string,
    partNumbers: number[],
    expiresInSeconds = 3600, // 1 hour for video chunks
  ): Promise<{ partNumber: number; url: string }[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(this.s3Client, command, {
          expiresIn: expiresInSeconds,
        });
        return { partNumber, url };
      }),
    );
  }

  /**
   * @description
   * Step 3 of 4 in a Multipart Upload. Finalizes the upload by telling R2
   * to merge all the uploaded chunks together. The client MUST provide the
   * ETags returned by R2 when it uploaded the chunks.
   *
   * @param {string} bucket - The R2 bucket name.
   * @param {string} key - The object key.
   * @param {string} uploadId - The ID returned from `createMultipartUpload`.
   * @param {Array<{ ETag: string; PartNumber: number }>} parts - The list of ETags and their part numbers.
   * @returns {Promise<void>}
   */
  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });
    await this.s3Client.send(command);
  }

  /**
   * @description
   * Step 4 of 4 (Optional). Aborts an ongoing multipart upload.
   * Use this to clean up R2 storage if the client abandons the upload.
   *
   * @param {string} bucket - The R2 bucket name.
   * @param {string} key - The object key.
   * @param {string} uploadId - The ID returned from `createMultipartUpload`.
   * @returns {Promise<void>}
   */
  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });
    await this.s3Client.send(command);
  }

  /**
   * @description
   * Generates a Presigned GET URL to view or download a private file.
   * Bypasses R2's default private nature securely.
   *
   * @param {string} bucket - The R2 bucket name.
   * @param {string} key - The object key.
   * @param {number} [expiresInSeconds=3600] - URL validity duration (default 1 hour).
   * @returns {Promise<string>} The presigned GET URL.
   */
  async generatePresignedDownloadUrl(
    bucket: string,
    key: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }
}
