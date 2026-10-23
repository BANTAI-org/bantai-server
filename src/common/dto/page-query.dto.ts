import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PageQueryDto {
  @ApiProperty({
    required: false,
    description: 'Maximum number of records per page',
    example: 20,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({
    required: false,
    description: 'Opaque cursor from the previous page',
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTIzIn0=',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;
}
