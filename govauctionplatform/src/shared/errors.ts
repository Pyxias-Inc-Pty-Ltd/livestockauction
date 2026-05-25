import HttpStatusCodes from 'http-status-codes';

export abstract class CustomError extends Error {
  public readonly HttpStatus = HttpStatusCodes.BAD_REQUEST;

  constructor(msg: string, httpStatus: number) {
    super(msg);
    this.HttpStatus = httpStatus;
  }
}

export class ParamMissingError extends CustomError {
  public static readonly Msg = 'One or more of the required parameters was missing.';
  public static readonly HttpStatus = HttpStatusCodes.BAD_REQUEST;

  constructor() {
    super(ParamMissingError.Msg, ParamMissingError.HttpStatus);
  }
}

export class NotFoundError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.NOT_FOUND;
  constructor(msg: string) {
    super(msg, NotFoundError.HttpStatus);
  }
}

export class ForbiddenError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.FORBIDDEN;
  constructor(msg: string) {
    super(msg, ForbiddenError.HttpStatus);
  }
}

export class RateLimitExceededError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.TOO_MANY_REQUESTS;
  constructor(msg: string) {
    super(msg, RateLimitExceededError.HttpStatus);
  }
}

export class UnauthorizedError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.UNAUTHORIZED;
  constructor(msg: string) {
    super(msg, UnauthorizedError.HttpStatus);
  }
}

export class BadRequestError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.BAD_REQUEST;
  constructor(msg: string) {
    super(msg, BadRequestError.HttpStatus);
  }
}

export class ConflictError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.CONFLICT;
  constructor(msg: string) {
    super(msg, ConflictError.HttpStatus);
  }
}

export class RequestTimeOutError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.REQUEST_TIMEOUT;
  constructor(msg: string) {
    super(msg, RequestTimeOutError.HttpStatus);
  }
}

export class InternalServerError extends CustomError {
  public static readonly HttpStatus = HttpStatusCodes.INTERNAL_SERVER_ERROR;
  constructor(msg: string) {
    super(msg, InternalServerError.HttpStatus);
  }
}
