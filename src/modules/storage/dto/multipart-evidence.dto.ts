import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsInt,
} from 'class-validator';

export class InitiateMultipartDto {
  @IsString()
  @IsNotEmpty()
  contentType!: string; // e.g., 'video/mp4'

  @IsString()
  @IsNotEmpty()
  fileName!: string; // e.g., 'front_camera.mp4'
}

export class SignPartsDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  partNumbers!: number[];
}

export class CompleteMultipartPartDto {
  @IsString()
  @IsNotEmpty()
  ETag!: string;

  @IsInt()
  PartNumber!: number;
}

export class CompleteMultipartDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @IsArray()
  @ArrayMinSize(1)
  parts!: CompleteMultipartPartDto[];
}
