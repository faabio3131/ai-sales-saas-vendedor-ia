import { AppErrorCategory, Result } from '../types/contracts';

/**
 * Base Application Error adhering to canonical contracts in docs/TECHNICAL_CONTRACTS.md.
 */
export class ApplicationError extends Error {
  public readonly category: AppErrorCategory;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  constructor(params: {
    category: AppErrorCategory;
    code: string;
    message: string;
    retryable?: boolean;
    statusCode?: number;
  }) {
    super(params.message);
    this.name = 'ApplicationError';
    this.category = params.category;
    this.code = params.code;
    this.retryable = params.retryable ?? false;
    this.statusCode = params.statusCode ?? mapCategoryToStatusCode(params.category);

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function mapCategoryToStatusCode(category: AppErrorCategory): number {
  switch (category) {
    case 'VALIDATION':
      return 400;
    case 'AUTH':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'RATE_LIMIT':
      return 429;
    case 'PROVIDER':
      return 502;
    case 'INTERNAL':
    default:
      return 500;
  }
}

/**
 * Helper to construct successful Result structures.
 */
export function createSuccessResult<T>(data: T): Result<T> {
  return {
    ok: true,
    data,
  };
}

/**
 * Helper to construct error Result structures.
 */
export function createErrorResult<T = never>(
  category: AppErrorCategory,
  code: string,
  message: string,
  retryable = false,
): Result<T> {
  return {
    ok: false,
    error: {
      category,
      code,
      message,
      retryable,
    },
  };
}
