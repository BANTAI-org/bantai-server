import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GetAuditLogsQueryDto {
  @ApiProperty({
    required: false,
    description: 'Maximum number of audit logs to return (1-100)',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({
    required: false,
    description: 'Opaque cursor from the previous page',
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTIzIn0=',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

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
