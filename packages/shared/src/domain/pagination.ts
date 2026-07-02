export interface PaginationInfo {
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage?: number;
  nextCursor?: string;
  totalCount?: number;
}
