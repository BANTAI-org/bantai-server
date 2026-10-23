import { IsOptional, IsDate, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GetSingleAuditQueryDto {
  @ApiProperty({
    required: false,
    description: 'Audit log creation timestamp filter in ISO 8601 format',
    example: '2026-10-23T01:30:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAt?: Date;

  @ApiProperty({
    required: false,
    description:
      'Command center UUID filter; required for super administrators',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsString()
  commandCenterId?: string;
}
