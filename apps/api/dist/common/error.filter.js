"use strict";
// Every error leaves in one shape: { error: { code, message, details? } }.
// Unexpected errors are logged and shown as a plain "something went wrong";
// a duplicate key becomes a 409 the screen can explain.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorFilter = void 0;
const common_1 = require("@nestjs/common");
let ErrorFilter = class ErrorFilter {
    log = new common_1.Logger("Error");
    catch(err, host) {
        const res = host.switchToHttp().getResponse();
        if (err instanceof common_1.HttpException) {
            const body = err.getResponse();
            const shaped = typeof body === "object" && body && "error" in body ? body : { error: { code: "http_" + err.getStatus(), message: typeof body === "string" ? body : body.message ?? err.message } };
            return res.status(err.getStatus()).json(shaped);
        }
        if (typeof err === "object" && err && err.code === 11000) {
            return res.status(409).json({ error: { code: "duplicate", message: "That already exists.", details: err.keyValue } });
        }
        this.log.error(err instanceof Error ? err.stack ?? err.message : String(err));
        return res.status(500).json({ error: { code: "server_error", message: "Something went wrong on our side. Try again." } });
    }
};
exports.ErrorFilter = ErrorFilter;
exports.ErrorFilter = ErrorFilter = __decorate([
    (0, common_1.Catch)()
], ErrorFilter);
//# sourceMappingURL=error.filter.js.map