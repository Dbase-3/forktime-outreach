// One error shape for the whole API: { error: { code, message, details? } }.
// Messages are plain words the front end can show as they are.

import { HttpException, HttpStatus } from "@nestjs/common";

export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
  }
}

export const notFound = (what = "That") => new ApiError(HttpStatus.NOT_FOUND, "not_found", `${what} isn't here. It may have been deleted.`);
export const conflict = (message: string, details?: unknown) => new ApiError(HttpStatus.CONFLICT, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "not_valid", message, details);
export const forbidden = (message = "You don't have access to that.") => new ApiError(HttpStatus.FORBIDDEN, "forbidden", message);
export const unauthorized = () => new ApiError(HttpStatus.UNAUTHORIZED, "signed_out", "Sign in to continue.");
export const tooMany = (message: string) => new ApiError(HttpStatus.TOO_MANY_REQUESTS, "slow_down", message);
/** Someone else saved it first: the client should reload it and try again. */
export const stale = (current: unknown) => new ApiError(HttpStatus.CONFLICT, "stale", "Someone else changed this just now. It's been reloaded.", { current });
