export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required.') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Resource not found.') {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, 'conflict', message, details);
  }
  static unprocessable(message: string, details?: unknown) {
    return new ApiError(422, 'unprocessable_entity', message, details);
  }
  static serviceUnavailable(code: string, message: string, details?: unknown) {
    return new ApiError(503, code, message, details);
  }
}
