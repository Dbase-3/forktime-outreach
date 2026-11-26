"use strict";
// One error shape for the whole API: { error: { code, message, details? } }.
// Messages are plain words the front end can show as they are.
Object.defineProperty(exports, "__esModule", { value: true });
exports.stale = exports.tooMany = exports.unauthorized = exports.forbidden = exports.unprocessable = exports.conflict = exports.notFound = exports.ApiError = void 0;
const common_1 = require("@nestjs/common");
class ApiError extends common_1.HttpException {
    constructor(status, code, message, details) {
        super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
    }
}
exports.ApiError = ApiError;
const notFound = (what = "That") => new ApiError(common_1.HttpStatus.NOT_FOUND, "not_found", `${what} isn't here. It may have been deleted.`);
exports.notFound = notFound;
const conflict = (message, details) => new ApiError(common_1.HttpStatus.CONFLICT, "conflict", message, details);
exports.conflict = conflict;
const unprocessable = (message, details) => new ApiError(common_1.HttpStatus.UNPROCESSABLE_ENTITY, "not_valid", message, details);
exports.unprocessable = unprocessable;
const forbidden = (message = "You don't have access to that.") => new ApiError(common_1.HttpStatus.FORBIDDEN, "forbidden", message);
exports.forbidden = forbidden;
const unauthorized = () => new ApiError(common_1.HttpStatus.UNAUTHORIZED, "signed_out", "Sign in to continue.");
exports.unauthorized = unauthorized;
const tooMany = (message) => new ApiError(common_1.HttpStatus.TOO_MANY_REQUESTS, "slow_down", message);
exports.tooMany = tooMany;
/** Someone else saved it first: the client should reload it and try again. */
const stale = (current) => new ApiError(common_1.HttpStatus.CONFLICT, "stale", "Someone else changed this just now. It's been reloaded.", { current });
exports.stale = stale;
//# sourceMappingURL=errors.js.map