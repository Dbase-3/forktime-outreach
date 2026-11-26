"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommonModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const error_filter_1 = require("./error.filter");
const guards_1 = require("./guards");
const workspace_data_1 = require("./workspace-data");
let CommonModule = class CommonModule {
};
exports.CommonModule = CommonModule;
exports.CommonModule = CommonModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            guards_1.AuthGuard,
            guards_1.WorkspaceGuard,
            workspace_data_1.WorkspaceData,
            { provide: core_1.APP_GUARD, useExisting: guards_1.AuthGuard },
            { provide: core_1.APP_GUARD, useExisting: guards_1.WorkspaceGuard },
            { provide: core_1.APP_FILTER, useClass: error_filter_1.ErrorFilter },
        ],
        exports: [guards_1.WorkspaceGuard, workspace_data_1.WorkspaceData],
    })
], CommonModule);
//# sourceMappingURL=common.module.js.map