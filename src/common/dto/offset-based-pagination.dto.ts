import { ApiProperty } from '@nestjs/swagger';

export class OffsetPageResponseDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ description: 'Total matching rows across all pages' })
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty({ description: 'True when offset + items.length < total' })
  has_more!: boolean;

  static from<T>(
    items: T[],
    total: number,
    limit: number,
    offset: number,
  ): OffsetPageResponseDto<T> {
    const dto = new OffsetPageResponseDto<T>();
    dto.items = items;
    dto.total = total;
    dto.limit = limit;
    dto.offset = offset;
    dto.has_more = offset + items.length < total;
    return dto;
  }
}
