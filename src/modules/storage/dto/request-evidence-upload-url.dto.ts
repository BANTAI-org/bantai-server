import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class RequestEvidenceUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(video\/mp4|video\/quicktime|image\/jpeg|image\/png)$/, {
    message: 'Only MP4, MOV, JPEG, and PNG files are allowed for evidence',
  })
  contentType!: string;

  @IsNumber()
  @Min(1024)
  @Max(100 * 1024 * 1024)
  fileSize!: number;
}
