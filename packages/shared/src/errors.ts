/**
 * Base error class for every error thrown inside briven services.
 * Per CLAUDE.md §6.3: never throw raw strings, always use a code.
 *
 * The public sanitiser strips internal paths, IPs, and credentials before
 * a customer-facing surface sees the error. Do that at boundaries, never in
 * the constructor.
 */
export class brivenError extends Error {
  readonly code: string;
  readonly status: number;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options: { status?: number; cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'brivenError';
    this.code = code;
    this.status = options.status ?? 500;
    this.cause = options.cause;
    this.context = options.context ? Object.freeze({ ...options.context }) : undefined;
  }

  toJSON(): { code: string; message: string; status: number } {
    return { code: this.code, message: this.message, status: this.status };
  }
}

export class NotFoundError extends brivenError {
  constructor(resource: string, id: string) {
    super('not_found', `${resource} not found`, { status: 404, context: { resource, id } });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends brivenError {
  constructor(message = 'authentication required') {
    super('unauthorized', message, { status: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends brivenError {
  constructor(message = 'forbidden') {
    super('forbidden', message, { status: 403 });
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends brivenError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('validation_failed', message, { status: 400, context });
    this.name = 'ValidationError';
  }
}

export class RateLimitedError extends brivenError {
  constructor(retryAfterSeconds: number) {
    super('rate_limited', 'rate limit exceeded', {
      status: 429,
      context: { retryAfterSeconds },
    });
    this.name = 'RateLimitedError';
  }
}
