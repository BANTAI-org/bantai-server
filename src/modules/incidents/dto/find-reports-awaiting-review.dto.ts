import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
/**
 * Query for findReportsAwaitingReview. command_center_id is honoured for a
 * super only (omit it for all centers). For an admin the service must IGNORE
 * this value and use the admin's own command center, otherwise an admin could
 * read another center's queue.
 */
export class FindReportsAwaitingReviewQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  command_center_id?: string;
}
