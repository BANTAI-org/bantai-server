import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsInt,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateMultipartDto {
  @ApiProperty({ description: 'Media MIME type', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  contentType!: string; // e.g., 'video/mp4'

  @ApiProperty({
    description: 'Original filename of the video',
    example: 'front_camera.mp4',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string; // e.g., 'front_camera.mp4'
}

export class SignPartsDto {
  @ApiProperty({
    description: 'R2 object key for the multipart upload',
    example: 'incidents/123/evidence_video.mp4',
  })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({
    description: 'Multipart upload ID returned by initiation',
    example: 'upload-abc123',
  })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @ApiProperty({
    type: [Number],
    description: 'Part numbers for which to create signed URLs',
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  partNumbers!: number[];
}

export class CompleteMultipartPartDto {
  @ApiProperty({
    description: 'ETag returned for this uploaded part',
    example: '"d41d8cd98f00b204e9800998ecf8427e"',
  })
  @IsString()
  @IsNotEmpty()
  ETag!: string;

  @ApiProperty({ description: 'One-based multipart part number', example: 1 })
  @IsInt()
  PartNumber!: number;
}

export class CompleteMultipartDto {
  @ApiProperty({
    description: 'R2 object key for the multipart upload',
    example: 'incidents/123/evidence_video.mp4',
  })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({
    description: 'Multipart upload ID returned by initiation',
    example: 'upload-abc123',
  })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @ApiProperty({
    type: () => [CompleteMultipartPartDto],
    description: 'Uploaded part numbers and ETags',
    example: [{ ETag: '"d41d8cd98f00b204e9800998ecf8427e"', PartNumber: 1 }],
  })
  @IsArray()
  @ArrayMinSize(1)
  parts!: CompleteMultipartPartDto[];
}
