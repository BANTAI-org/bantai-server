import { CursorPage } from '../../../common/utils/cursor-pagination-helper.util';
/** Response envelope for any cursor-paginated list. */
export class CursorPageResponseDto<T> {
  items!: T[];
  /** Pass back as ?cursor= to fetch the next page; null on the last page. */
  nextCursor!: CursorPage<unknown>['nextCursor'];

  static from<E, T>(
    page: CursorPage<E>,
    map: (item: E) => T,
  ): CursorPageResponseDto<T> {
    const dto = new CursorPageResponseDto<T>();
    dto.items = page.items.map(map);
    dto.nextCursor = page.nextCursor;
    return dto;
  }
}
