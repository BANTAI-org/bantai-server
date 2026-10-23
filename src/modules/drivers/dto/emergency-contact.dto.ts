import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const MOBILE_PATTERN = /^\+639\d{9}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One element of d_profile.emergency_contacts (a JSONB array, 1 to 3
 * entries). The ONE definition shared by the create and patch DTOs,
 * so the keys stored in the JSON ({ name, relation, number }) can
 * never drift between registration and a later edit.
 */
export class EmergencyContactDto {
  @ApiProperty({
    description: 'Emergency contact full name',
    example: 'Maria Santos',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'Relationship to the account holder',
    example: 'Spouse',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relation!: string;

  @ApiProperty({
    description: 'Contact mobile number in Philippine E.164 format',
    example: '+639171234567',
  })
  @Matches(MOBILE_PATTERN, {
    message: 'contact number must be a valid PH mobile number',
  })
  number!: string;
}
