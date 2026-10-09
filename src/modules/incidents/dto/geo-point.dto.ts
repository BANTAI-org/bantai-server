import { IsNumber, Min, Max } from 'class-validator';
import { GeoPoint } from '../../../common/interfaces/geo-location.interface';

export class GeoPointDTO implements GeoPoint {
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;
}
