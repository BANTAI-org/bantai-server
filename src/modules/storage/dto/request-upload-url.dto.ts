import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestUploadUrlDto {
  @ApiProperty({
    example: 'image/jpeg',
    description: 'The MIME type of the image',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^image\/(jpeg|png|webp)$/, {
    message: 'Only JPEG, PNG, and WebP images are allowed',
  })
  contentType!: string;

  @ApiProperty({
    example: 102400,
    description: 'File size in bytes (Max 5MB)',
  })
  @IsNumber()
  @Min(1024)
  @Max(20 * 1024 * 1024)
  fileSize!: number;
}
