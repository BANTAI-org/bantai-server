import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  ValidateIf,
} from 'class-validator';
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
    required: false,
    description:
      'Device UUID to pair. Provide either this or hardwareSerial — at least one is required.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ValidateIf((o: PairDeviceDto) => !o.hardwareSerial)
  @IsString()
  @IsNotEmpty()
  deviceId?: string;

  @ApiProperty({
    required: false,
    description:
      'Hardware serial scanned from the QR sticker. Provide either this or deviceId — at least one is required.',
    example: 'BANTAI-CAM-000123',
  })
  @ValidateIf((o: PairDeviceDto) => !o.deviceId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  hardwareSerial?: string;

  @ApiProperty({
    description: 'Driver UUID to pair with the device',
    example: '7fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsNotEmpty()
  driverId!: string;
}
