import { IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';
import { CCEnum } from '../enums/cc.enum';
import { type GeoPoint } from '../../../common/interfaces/geo-location.interface';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommandCenterDTO {
  @ApiProperty({
    description: 'Command center name',
    example: 'Central District Command Center',
  })
  @IsString()
  @Length(4, 256)
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    enum: CCEnum,
    description: 'Type of the command center',
    example: CCEnum.BARANGAY,
  })
  @IsNotEmpty()
  @IsEnum(CCEnum)
  type!: CCEnum;

  @ApiProperty({
    description: 'Command center branch name',
    example: 'Central District',
  })
  @IsString()
  @Length(4, 256)
  @IsNotEmpty()
  branch!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      latitude: {
        type: 'number',
        description: 'Latitude in decimal degrees',
        example: 14.676,
      },
      longitude: {
        type: 'number',
        description: 'Longitude in decimal degrees',
        example: 121.0437,
      },
    },
    required: ['latitude', 'longitude'],
    description: 'Command center geographic coordinates',
    example: { latitude: 14.676, longitude: 121.0437 },
  })
  @IsNotEmpty()
  location!: GeoPoint;
}
