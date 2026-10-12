import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  hardwareSerial!: string;

  @IsOptional()
  @IsString()
  registeredBy?: string;
}

export class PairDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  driverId!: string;
}
