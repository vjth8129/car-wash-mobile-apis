export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

/**
 * Why someone at a car wash that isn't ACTIVE can't sign in. Clients switch on the code:
 * CAR_WASH_PENDING shows the "under review" page, the others show the message.
 */
const CAR_WASH_BLOCKED: Record<string, { code: string; message: string }> = {
  PENDING: {
    code: 'CAR_WASH_PENDING',
    message: 'Your details are under review. Your account will be activated within 2 hours.',
  },
  SUSPENDED: {
    code: 'CAR_WASH_SUSPENDED',
    message:
      'Your account is suspended. Please renew your account or contact Vahanly customer care.',
  },
  INACTIVE: {
    code: 'CAR_WASH_INACTIVE',
    message: 'Your car wash is no longer active. Please contact Vahanly customer care.',
  },
};

export class CarWashNotActiveError extends AppError {
  constructor(status: string) {
    const blocked = CAR_WASH_BLOCKED[status] ?? CAR_WASH_BLOCKED.INACTIVE;
    super(blocked.message, 403, blocked.code);
  }
}
