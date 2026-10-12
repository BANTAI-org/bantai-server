import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/**
 * Query for the incident log of a command center. An admin always gets their
 * own center (this value is ignored); a super must say which one.
 */
export class FindIncidentLogsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  command_center_id?: string;
}
