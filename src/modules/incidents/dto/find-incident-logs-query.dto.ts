import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Query for the incident log of a command center. An admin always gets their
 * own center (this value is ignored); a super must say which one.
 */
export class FindIncidentLogsQueryDto extends PageQueryDto {
  @ApiProperty({
    required: false,
    description: 'Command center UUID; required for super administrators',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsString()
  command_center_id?: string;
}
