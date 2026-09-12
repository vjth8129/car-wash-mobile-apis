export interface PaginationQuery {
  page: number;
  limit: number;
  offset: number;
}

export function parsePaginationQuery(query: Record<string, unknown>): PaginationQuery {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
