import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
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
import { AuthProviderEnum } from '../../responders/enums/auth-provider.enum';
import { ServiceProviderEnum } from '../../responders/enums/service-provider.enum';
import { BloodTypeEnum } from '../../responders/enums/blood-type.enum';
import { EmergencyContactDto } from './emergency-contact.dto';
import { ApiProperty } from '@nestjs/swagger';

const NAME_PATTERN = /^[\p{L}\s-]+$/u;
const MOBILE_PATTERN = /^\+639\d{9}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The single request body for POST /drivers/register — the "Verify &
 * Create Account" step at the end of the 6-screen wizard. Everything
 * the wizard collected arrives here together; DriverRepository
 * performs exactly one transactional INSERT across user_account +
 * d_profile. Nothing is persisted before this call (see
 * chck_auth_requirements: a driver row is complete and 'active' from
 * the moment it exists).
 *
 * otp_code is verified by the OTP layer BEFORE DriverService runs; the
 * service receives the resulting phoneVerifiedAt timestamp.
 *
 * Every @MaxLength below matches a column width. Without them an
 * overlong value reaches Postgres and fails there with a 22001 error
 * instead of a clean 400.
 *
 * Face enrollment (wizard screen 5) has no field: the face map is
 * stored on-device and never sent to the server.
 */
export class CreateDriverDto {
  // ---------------------------------------------------------------
  // Screen 1: Personal details
  // ---------------------------------------------------------------
  @ApiProperty({ description: 'Driver first name', example: 'Juan' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(NAME_PATTERN, {
    message: 'f_name may only contain letters, spaces, and hyphens.',
  })
  f_name!: string;

  @ApiProperty({ description: 'Driver last name', example: 'Dela Cruz' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(NAME_PATTERN, {
    message: 'l_name may only contain letters, spaces, and hyphens.',
  })
  l_name!: string;

  @ApiProperty({
    required: false,
    description: 'Driver middle name',
    example: 'Santos',
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(NAME_PATTERN, {
    message: 'm_name may only contain letters, spaces, and hyphens.',
  })
  m_name?: string;

  // 'YYYY-MM-DD'. `strict` rejects impossible dates such as 2001-02-30,
  // which a plain @IsDateString would let through to fail in Postgres.
  // That it is a PAST date is checked in DriverService.
  @ApiProperty({
    description: 'Date of birth in YYYY-MM-DD format',
    example: '1990-05-20',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'date_of_birth must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date_of_birth!: string;

  // Street + city are composed into one string client-side, matching
  // d_profile.address's single TEXT column.
  @ApiProperty({
    description: 'Residential address',
    example: '123 Rizal Street, Quezon City',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

  // ---------------------------------------------------------------
  // Screen 2: Account & login
  // ---------------------------------------------------------------
  @ApiProperty({
    description: 'Verified Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @Matches(MOBILE_PATTERN, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number!: string;

  // For local sign-ups this is the account email. For Google/Apple it is
  // ignored: DriverService stores the email from the verified token.
  @ApiProperty({
    description: 'Account email address',
    example: 'juan.delacruz@example.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(150)
  email!: string;

  /**
   * Which identity path this registration used. Picks which credential
   * is required below (password for local, social_id_token for
   * Google/Apple), mirroring chck_auth_requirements so a malformed
   * combination gets a 400.
   */
  @ApiProperty({
    enum: AuthProviderEnum,
    description: 'Authentication provider used for registration',
    example: AuthProviderEnum.LOCAL,
  })
  @IsEnum(AuthProviderEnum)
  auth_provider!: AuthProviderEnum;

  // bcrypt ignores everything past 72 bytes, so longer input is
  // rejected rather than silently half-checked at login. Not trimmed:
  // spaces are valid password characters.
  @ApiProperty({
    required: false,
    description: 'Password required for local authentication',
    example: 'StrongPass123!',
  })
  @ValidateIf(
    (dto: CreateDriverDto) => dto.auth_provider === AuthProviderEnum.LOCAL,
  )
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  password?: string;

  /**
   * ID token from the chosen provider (Google or Apple), fetched FRESH
   * at submission time (these expire in about an hour and the wizard
   * can take longer). Verified in DriverService through the provider's
   * SocialIdentityVerifier; the stored email comes from the verified
   * token, not from the `email` field above.
   */
  @ApiProperty({
    required: false,
    description: 'Fresh provider ID token required for social authentication',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @ValidateIf(
    (dto: CreateDriverDto) => dto.auth_provider !== AuthProviderEnum.LOCAL,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  social_id_token?: string;

  // ---------------------------------------------------------------
  // Screen 3: License & operator
  // ---------------------------------------------------------------
  @ApiProperty({
    enum: ServiceProviderEnum,
    description: 'Driver service provider',
    example: ServiceProviderEnum.INDEPENDENT,
  })
  @IsEnum(ServiceProviderEnum)
  service_provider!: ServiceProviderEnum;

  /**
   * Required for every platform except independent, mirroring
   * service_id_requires_provider. (For independent, DriverService
   * stores null even if a stale value arrives.)
   */
  @ApiProperty({
    required: false,
    description:
      'Service provider identifier, required unless provider is independent',
    example: 'TODA-1024',
  })
  @ValidateIf(
    (dto: CreateDriverDto) =>
      dto.service_provider !== ServiceProviderEnum.INDEPENDENT,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  service_id?: string;

  @ApiProperty({
    description: 'Driver license number',
    example: 'N01-23-456789',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  license_number!: string;

  @ApiProperty({
    description: 'Driver license expiry date in YYYY-MM-DD format',
    example: '2028-08-31',
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'license_expires_at must be YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  license_expires_at!: string;

  // Max 80 also keeps the value inside the SMALLINT column.
  @ApiProperty({ description: 'Years of riding experience', example: 8 })
  @IsInt()
  @Min(0)
  @Max(80)
  years_riding!: number;

  // Genuinely optional ("Optional — TODA or fleet"), independent of
  // service_provider.
  @ApiProperty({
    required: false,
    description: 'Fleet operator identifier, if applicable',
    example: 'FLEET-204',
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fleet_operator_id?: string;

  // ---------------------------------------------------------------
  // Screen 4: Vehicle & medical info
  // ---------------------------------------------------------------
  @ApiProperty({ description: 'Vehicle plate number', example: 'ABC1234' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plate_number!: string;

  @ApiProperty({
    description: 'Vehicle make and model',
    example: 'Honda Click 150i',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  vehicle_model!: string;

  @ApiProperty({ description: 'Vehicle color', example: 'Matte black' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  vehicle_color!: string;

  @ApiProperty({
    enum: BloodTypeEnum,
    description: 'Driver blood type',
    example: BloodTypeEnum.O_PLUS,
  })
  @IsEnum(BloodTypeEnum)
  blood_type!: BloodTypeEnum;

  // Free text, required — "none" is itself a valid, expected answer.
  @ApiProperty({
    description: 'Known medical conditions; use "none" if there are none',
    example: 'None',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  medical_conditions!: string;

  // 1 to 3 contacts: the wizard requires one, the DB caps it at three
  // (emergency_contacts_max_three).
  @ApiProperty({
    type: () => [EmergencyContactDto],
    description: 'One to three emergency contacts',
    example: [
      { name: 'Maria Santos', relation: 'Spouse', number: '+639171234567' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least 1 emergency contact is required' })
  @ArrayMaxSize(3, { message: 'at most 3 emergency contacts are allowed' })
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactDto)
  emergency_contacts!: EmergencyContactDto[];

  /**
   * The consent checkbox. @Equals(true): an explicit `false` or an
   * omission both fail, so a request can't succeed without having
   * affirmatively agreed.
   */
  @ApiProperty({
    description: 'Affirmative data-sharing consent',
    example: true,
  })
  @Equals(true, { message: 'data_sharing_consent must be explicitly true' })
  data_sharing_consent!: boolean;

  // ---------------------------------------------------------------
  // Screen 6: Phone verification -> this is nothing, not required
  // ---------------------------------------------------------------
}
