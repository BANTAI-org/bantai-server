import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AgencyTypeEnum } from '../enums/agency-type.enum';
import { PoliceRank } from '../enums/police-rank.enum';
import { Role } from '../../../common/enums/role-enum';
import { ApiProperty } from '@nestjs/swagger';

// Mirrors the Postgres check on f_name / l_name / m_name:
// letters (any script), whitespace, and hyphens only.
const NAME_PATTERN = /^[\p{L}\s-]+$/u;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Same, but turns an empty string into undefined so optional fields
// left blank in a form don't fail validation or reach the database.
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Shape validation only. Rules that depend on more than one field
 * (police needs a call sign and a real rank, MDRRMO needs a call sign)
 * are enforced in ResponderService, where they can return a clear 400.
 *
 * Despite the name, this DTO backs provisioning for BOTH `responder`
 * and `admin` accounts — `role` picks which, defaulting to `responder`
 * when omitted (see ResponderService.createResponder). It deliberately
 * does NOT accept `super` or `driver`: super is never created through
 * this endpoint, and drivers self-register through a separate flow
 * entirely, so @IsIn below is an explicit allowlist rather than a
 * blanket @IsEnum(Role) — a caller cannot request either of those
 * values no matter what else changes upstream.
 *
 * agency / call_sign / rank are r_profile fields and only apply when
 * the account being created is a responder. agency is validated as
 * required ONLY in that case (@ValidateIf below); for an admin it is
 * never read and no r_profile row is ever inserted — see
 * ResponderService.createResponder and ResponderRepository.
 *
 * Deliberately absent: command_center_id is NOT accepted here for a
 * normal admin caller — a responder or admin is always provisioned
 * into the calling admin's own command center, taken from their JWT,
 * so a client can't create accounts in someone else's. It stays
 * optional on the DTO only for the existing Role.SUPER override path
 * (a super admin has no command center of their own and must specify
 * one explicitly) — that branch is unchanged by this fix.
 *
 * Requires ValidationPipe({ transform: true }) for the @Transform
 * normalization (trim, lowercase email) to actually run.
 */
export class CreateResponderDto {
  @ApiProperty({ description: 'Responder first name', example: 'Ana' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(NAME_PATTERN, {
    message: 'f_name may only contain letters, spaces, and hyphens.',
  })
  f_name!: string;

  @ApiProperty({ description: 'Responder last name', example: 'Reyes' })
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
    description: 'Responder middle name',
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

  // Emails are case-insensitive in practice but Postgres compares them
  // exactly, so normalize once here and everything downstream is safe.
  @ApiProperty({
    description: 'Account email address',
    example: 'ana.reyes@example.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(150)
  email!: string;

  /**
   * Which kind of account to create. Defaults to Role.RESPONDER when
   * omitted (see ResponderService). @IsIn is an explicit two-value
   * allowlist rather than @IsEnum(Role) so `super` (and `driver`) can
   * never be requested through this endpoint, regardless of any
   * role-based guard elsewhere in the request pipeline.
   */
  @ApiProperty({
    required: false,
    enum: [Role.RESPONDER, Role.ADMIN],
    description: 'Account role (defaults to responder)',
    example: Role.RESPONDER,
  })
  @IsOptional()
  @IsIn([Role.RESPONDER, Role.ADMIN], {
    message: 'role must be either responder or admin.',
  })
  role?: Role;

  /**
   * Required only when creating a responder (role is Role.RESPONDER,
   * or role is omitted since that's the default). Skipped entirely —
   * via @ValidateIf, not just left optional — when role is
   * Role.ADMIN, since an admin account has no r_profile row and this
   * value would otherwise be silently meaningless.
   */
  @ApiProperty({
    required: false,
    enum: AgencyTypeEnum,
    description: 'Responder agency, required for responder accounts',
    example: AgencyTypeEnum.POLICE,
  })
  @ValidateIf(
    (dto: CreateResponderDto) =>
      (dto.role ?? Role.RESPONDER) === Role.RESPONDER,
  )
  @IsEnum(AgencyTypeEnum)
  agency?: AgencyTypeEnum;

  @ApiProperty({
    required: false,
    description: 'Responder call sign',
    example: 'ALPHA-12',
  })
  @Transform(trimToUndefined)
  @ApiProperty({
    required: false,
    enum: PoliceRank,
    description: 'Police rank when applicable',
    example: PoliceRank.PCPT,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  call_sign?: string;

  @ApiProperty({
    required: false,
    description: 'Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @IsOptional()
  @IsEnum(PoliceRank)
  rank?: PoliceRank;

  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;

  // Optional in body validation; required when caller is Role.SUPER
  @ApiProperty({
    required: false,
    description:
      'Command center UUID; required when created by a super administrator',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsUUID('4', { message: 'command_center_id must be a valid UUID v4' })
  command_center_id?: string;
}
