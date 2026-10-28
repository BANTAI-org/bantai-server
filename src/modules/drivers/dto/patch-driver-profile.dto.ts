import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DriverProfilePatch } from '../types/patch-driver-identity.types';
import { UserAccountPatch } from '../types/patch-user-account.type';
import { ServiceProviderEnum } from '../../responders/enums/service-provider.enum';
import { BloodTypeEnum } from '../../responders/enums/blood-type.enum';
import { EmergencyContactDto } from './emergency-contact.dto';
import { ApiProperty } from '@nestjs/swagger';

// Same rules as chck_*_name_format and chck_m_number_format.
const NAME_REGEX = /^[\p{L}\s-]+$/u;
const PH_MOBILE_REGEX = /^\+639\d{9}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const OTP_REGEX = /^\d{6}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// For NULLABLE columns: a blank string means "clear it", not "leave
// it alone" (omit the key for that).
const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * Body for PATCH /drivers/me. Every field is optional. Clients should
 * send only the fields that changed (diff the form).
 *
 * Null handling, field by field:
 *   - NOT NULL columns, and the ones the wizard always fills
 *     (m_number, plate_number, address, date_of_birth,
 *     emergency_contacts): may be omitted, but never sent as null.
 *     They use @ValidateIf(!== undefined) so null is validated and
 *     rejected, unlike @IsOptional, which would let it through.
 *   - Nullable columns (m_name, service_id, fleet_operator_id, avatar_url): may be
 *     omitted or explicitly null; a blank string is treated as null.
 *
 * Not patchable here on purpose: email, role, password,
 * auth_provider, provider_id, phone_verified_at, account_status,
 * data_sharing_consented_at. Run this behind a ValidationPipe with
 * { whitelist: true, forbidNonWhitelisted: true, transform: true } so
 * any such field is rejected instead of silently ignored.
 */
export class PatchDriverProfileDto {
  // ---------- user_account ----------
  @ApiProperty({
    required: false,
    description: 'Updated first name',
    example: 'Juan',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.f_name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(NAME_REGEX, {
    message: 'f_name may only contain letters, spaces and hyphens',
  })
  f_name?: string;

  @ApiProperty({
    required: false,
    description: 'Updated last name',
    example: 'Dela Cruz',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.l_name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(NAME_REGEX, {
    message: 'l_name may only contain letters, spaces and hyphens',
  })
  l_name?: string;

  @ApiProperty({
    required: false,
    description: 'Updated middle name; blank values clear it',
    example: 'Santos',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(NAME_REGEX, {
    message: 'm_name may only contain letters, spaces and hyphens',
  })
  m_name?: string | null;

  @ApiProperty({
    required: false,
    description: 'New Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.m_number !== undefined)
  @Matches(PH_MOBILE_REGEX, {
    message: 'm_number must be in the format +639XXXXXXXXX',
  })
  m_number?: string;

  @ApiProperty({
    required: false,
    description:
      'The R2 object key returned from the profile image upload endpoint',
    example: 'users/123/avatar.jpg',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar_url?: string | null;

  /**
   * Required whenever m_number is sent: a changed number must be
   * proven with a fresh SMS code. The controller verifies it with the
   * OTP layer and passes the resulting phoneVerifiedAt to
   * DriverService.updateProfile. Not a column, so it never reaches
   * the patch objects below.
   */
  @ApiProperty({
    required: false,
    description: 'Six-digit OTP for verifying a changed mobile number',
    example: '123456',
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.m_number !== undefined)
  @Matches(OTP_REGEX, { message: 'otp_code must be a 6-digit code' })
  otp_code?: string;

  // ---------- d_profile ----------
  @ApiProperty({
    required: false,
    enum: ServiceProviderEnum,
    description: 'Updated driver service provider',
    example: ServiceProviderEnum.INDEPENDENT,
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.service_provider !== undefined)
  @IsEnum(ServiceProviderEnum)
  service_provider?: ServiceProviderEnum;

  @ApiProperty({
    required: false,
    description: 'Updated service provider identifier; null clears it',
    example: 'TODA-1024',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  service_id?: string | null;

  @ApiProperty({
    required: false,
    description: 'Updated vehicle plate number',
    example: 'ABC1234',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @ValidateIf((o: PatchDriverProfileDto) => o.plate_number !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  plate_number?: string;

  @ApiProperty({
    required: false,
    enum: BloodTypeEnum,
    description: 'Updated blood type',
    example: BloodTypeEnum.O_PLUS,
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.blood_type !== undefined)
  @IsEnum(BloodTypeEnum)
  blood_type?: BloodTypeEnum;

  @ApiProperty({
    required: false,
    description: 'Updated residential address',
    example: '123 Rizal Street, Quezon City',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.address !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address?: string;

  @ApiProperty({
    required: false,
    description: 'Updated date of birth in YYYY-MM-DD format',
    example: '1990-05-20',
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.date_of_birth !== undefined)
  @Matches(DATE_ONLY_REGEX, { message: 'date_of_birth must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date_of_birth?: string;

  @ApiProperty({
    required: false,
    type: () => [EmergencyContactDto],
    description: 'Replacement list of emergency contacts',
    example: [
      { name: 'Maria Santos', relation: 'Spouse', number: '+639171234567' },
    ],
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.emergency_contacts !== undefined)
  @IsArray()
  @ArrayMinSize(1, { message: 'at least 1 emergency contact is required' })
  @ArrayMaxSize(3, { message: 'at most 3 emergency contacts are allowed' })
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactDto)
  emergency_contacts?: EmergencyContactDto[];

  @ApiProperty({
    required: false,
    description: 'Updated driver license number',
    example: 'N01-23-456789',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.license_number !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  license_number?: string;

  @ApiProperty({
    required: false,
    description: 'Updated license expiry in YYYY-MM-DD format',
    example: '2028-08-31',
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.license_expires_at !== undefined)
  @Matches(DATE_ONLY_REGEX, {
    message: 'license_expires_at must be YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  license_expires_at?: string;

  @ApiProperty({
    required: false,
    description: 'Updated years of riding experience',
    example: 8,
  })
  @ValidateIf((o: PatchDriverProfileDto) => o.years_riding !== undefined)
  @IsInt()
  @Min(0)
  @Max(80)
  years_riding?: number;

  @ApiProperty({
    required: false,
    description: 'Updated fleet operator identifier; null clears it',
    example: 'FLEET-204',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fleet_operator_id?: string | null;

  @ApiProperty({
    required: false,
    description: 'Updated vehicle make and model',
    example: 'Honda Click 150i',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.vehicle_model !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  vehicle_model?: string;

  @ApiProperty({
    required: false,
    description: 'Updated vehicle color',
    example: 'Matte black',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.vehicle_color !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vehicle_color?: string;

  @ApiProperty({
    required: false,
    description: 'Updated medical conditions',
    example: 'None',
  })
  @Transform(trim)
  @ValidateIf((o: PatchDriverProfileDto) => o.medical_conditions !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  medical_conditions?: string;
}

/** Picks the user_account fields out of the DTO. */
export function toUserAccountPatch(
  dto: PatchDriverProfileDto,
): UserAccountPatch {
  const { f_name, l_name, m_name, m_number, avatar_url } = dto;
  return { f_name, l_name, m_name, m_number, avatar_url };
}

/** Picks the d_profile fields out of the DTO. */
export function toDriverProfilePatch(
  dto: PatchDriverProfileDto,
): DriverProfilePatch {
  const {
    service_provider,
    service_id,
    plate_number,
    blood_type,
    address,
    date_of_birth,
    emergency_contacts,
    license_number,
    license_expires_at,
    years_riding,
    fleet_operator_id,
    vehicle_model,
    vehicle_color,
    medical_conditions,
  } = dto;
  return {
    service_provider,
    service_id,
    plate_number,
    blood_type,
    address,
    date_of_birth,
    emergency_contacts,
    license_number,
    license_expires_at,
    years_riding,
    fleet_operator_id,
    vehicle_model,
    vehicle_color,
    medical_conditions,
  };
}
