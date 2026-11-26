"use strict";
// Loads what the shared rules (@outreach/core) need to judge a change: the
// workspace's agents, campaigns, fields and settings, in core shapes.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceData = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const serialize_1 = require("./serialize");
let WorkspaceData = class WorkspaceData {
    agents;
    campaigns;
    fields;
    workspaces;
    constructor(agents, campaigns, fields, workspaces) {
        this.agents = agents;
        this.campaigns = campaigns;
        this.fields = fields;
        this.workspaces = workspaces;
    }
    async flows(ws) {
        return (await this.agents.find({ workspaceId: ws, deletedAt: null }).lean()).map(serialize_1.agentOut);
    }
    async campaignsOf(ws) {
        return (await this.campaigns.find({ workspaceId: ws, deletedAt: null }).lean()).map(serialize_1.campaignOut);
    }
    async defs(ws) {
        return (await this.fields.find({ workspaceId: ws }).lean()).map(serialize_1.fieldOut);
    }
    /** Fields a decision may test without asking: the contact's own, typed, plus name and phone. */
    async knownFields(ws) {
        return [...(await this.defs(ws)).map((d) => ({ key: d.key, type: d.type })), "name", "phone"];
    }
    async settings(ws) {
        const w = await this.workspaces.findById(ws).lean();
        const s = w?.settings;
        return { businessName: s?.businessName ?? "", timezone: s?.timezone ?? "Australia/Sydney", callingDays: s?.callingDays ?? [1, 2, 3, 4, 5], callingStart: s?.callingStart ?? 9, callingEnd: s?.callingEnd ?? 19, doNotCall: s?.doNotCall ?? [], phoneNumber: "", inboundFlowId: "" };
    }
};
exports.WorkspaceData = WorkspaceData;
exports.WorkspaceData = WorkspaceData = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)("Agent")),
    __param(1, (0, mongoose_1.InjectModel)("Campaign")),
    __param(2, (0, mongoose_1.InjectModel)("FieldDef")),
    __param(3, (0, mongoose_1.InjectModel)("Workspace")),
    __metadata("design:paramtypes", [Object, Object, Object, Object])
], WorkspaceData);
//# sourceMappingURL=workspace-data.js.map