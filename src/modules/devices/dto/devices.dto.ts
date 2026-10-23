import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDeviceDto {
  @ApiProperty({
    description: 'Unique hardware serial number',
    example: 'BANTAI-CAM-000123',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  hardwareSerial!: string;

  @ApiProperty({
    required: false,
    description: 'UUID of the user registering the device',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsString()
  registeredBy?: string;
}

export class PairDeviceDto {
  @ApiProperty({
    description: 'Device UUID to pair',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiProperty({
    description: 'Driver UUID to pair with the device',
    example: '7fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsNotEmpty()
  driverId!: string;
}
