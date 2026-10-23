import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Query for findReportsAwaitingReview. command_center_id is honoured for a
 * super only (omit it for all centers). For an admin the service must IGNORE
 * this value and use the admin's own command center, otherwise an admin could
 * read another center's queue.
 */
export class FindReportsAwaitingReviewQueryDto extends PageQueryDto {
  @ApiProperty({
    required: false,
    description:
      'Command center UUID used by super administrators to filter results',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsString()
  command_center_id?: string;
}
