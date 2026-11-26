"use strict";
// Route markers read by the guards: @Public() skips sign-in; @Roles() limits a
// workspace route to some roles. Everything else needs a signed-in member.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ctx = exports.Roles = exports.ROLES = exports.Public = exports.IS_PUBLIC = void 0;
const common_1 = require("@nestjs/common");
exports.IS_PUBLIC = "isPublic";
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC, true);
exports.Public = Public;
exports.ROLES = "roles";
const Roles = (...roles) => (0, common_1.SetMetadata)(exports.ROLES, roles);
exports.Roles = Roles;
/** The signed-in user and, on /w/:ws routes, the workspace and role. */
exports.Ctx = (0, common_1.createParamDecorator)((_data, ctx) => ctx.switchToHttp().getRequest().ctx);
//# sourceMappingURL=decorators.js.map