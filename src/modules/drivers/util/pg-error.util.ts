export interface PgErrorLike {
  code?: string;
  constraint?: string;
}

export function isPgError(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error;
}
