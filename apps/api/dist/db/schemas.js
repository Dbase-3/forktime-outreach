"use strict";
// Every collection the platform keeps (docs/PLATFORM_ROADMAP.md §5). Every
// workspace document carries workspaceId; editable ones carry `version` (for
// "someone else changed this" conflicts) and `deletedAt` (soft delete). The
// indexes enforce the rules the UI shows: one agent per number, one contact per
// number, unique field keys, one membership per person.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODELS = exports.IntegrationSchema = exports.CallSchema = exports.CampaignSchema = exports.KnowledgeSchema = exports.ImportSchema = exports.SourceSchema = exports.ContactSchema = exports.FieldDefSchema = exports.NumberSchema = exports.AgentVersionSchema = exports.AgentSchema = exports.InviteSchema = exports.MembershipSchema = exports.WorkspaceSchema = exports.LoginCodeSchema = exports.SessionSchema = exports.UserSchema = exports.ROLES = void 0;
const mongoose_1 = require("mongoose");
const { ObjectId, Mixed } = mongoose_1.Schema.Types;
exports.ROLES = ["owner", "admin", "member"];
const opts = { timestamps: true, minimize: false, versionKey: false };
// ---- People and access ----
exports.UserSchema = new mongoose_1.Schema({ email: { type: String, required: true, unique: true }, name: { type: String, default: "" }, lastSignInAt: Date }, opts);
exports.SessionSchema = new mongoose_1.Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: ObjectId, required: true, index: true },
    expiresAt: { type: Date, required: true },
    ip: String,
    userAgent: String,
}, opts);
exports.SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
exports.LoginCodeSchema = new mongoose_1.Schema({ email: { type: String, required: true, index: true }, codeHash: { type: String, required: true }, expiresAt: { type: Date, required: true }, attempts: { type: Number, default: 0 }, ip: String }, opts);
exports.LoginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // kept an hour past expiry for rate limits
const SettingsShape = {
    businessName: { type: String, required: true },
    timezone: { type: String, default: "Australia/Sydney" },
    callingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    callingStart: { type: Number, default: 9 },
    callingEnd: { type: Number, default: 19 },
    doNotCall: { type: [String], default: [] },
};
exports.WorkspaceSchema = new mongoose_1.Schema({ name: { type: String, required: true }, settings: SettingsShape, version: { type: Number, default: 1 }, createdBy: ObjectId }, opts);
exports.MembershipSchema = new mongoose_1.Schema({ workspaceId: { type: ObjectId, required: true }, userId: { type: ObjectId, required: true, index: true }, role: { type: String, enum: exports.ROLES, required: true } }, opts);
exports.MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
exports.InviteSchema = new mongoose_1.Schema({ workspaceId: { type: ObjectId, required: true }, email: { type: String, required: true, index: true }, role: { type: String, enum: exports.ROLES, required: true }, invitedBy: ObjectId, acceptedAt: Date }, opts);
exports.InviteSchema.index({ workspaceId: 1, email: 1 }, { unique: true });
// ---- Agents ----
exports.AgentSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true },
    draft: { type: Mixed, required: true }, // AgentDraft (packages/core/src/schemas.ts)
    status: { type: String, enum: ["draft", "live"], default: "draft" },
    numberId: { type: ObjectId, default: null },
    publishedVersionId: { type: ObjectId, default: null },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
}, opts);
exports.AgentSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });
// One agent per number. A deleted agent gives its number up (numberId unset), so it can't block.
exports.AgentSchema.index({ numberId: 1 }, { unique: true, partialFilterExpression: { numberId: { $type: "objectId" } } });
exports.AgentVersionSchema = new mongoose_1.Schema({ workspaceId: { type: ObjectId, required: true }, agentId: { type: ObjectId, required: true }, n: { type: Number, required: true }, config: { type: Mixed, required: true }, publishedBy: ObjectId }, opts);
exports.AgentVersionSchema.index({ agentId: 1, n: 1 }, { unique: true });
// ---- Numbers ----
exports.NumberSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true, index: true },
    e164: { type: String, required: true, unique: true },
    display: { type: String, required: true },
    country: { type: String, required: true },
    kind: { type: String, enum: ["local", "mobile", "tollfree"], required: true },
    area: String,
    provider: { type: String, default: "fake" }, // "telnyx" in Phase 3
    providerId: String,
    status: { type: String, enum: ["active", "releasing"], default: "active" },
}, opts);
// ---- Contacts ----
exports.FieldDefSchema = new mongoose_1.Schema({ workspaceId: { type: ObjectId, required: true }, key: { type: String, required: true }, label: { type: String, required: true }, type: { type: String, required: true }, choices: [String], source: String }, opts);
exports.FieldDefSchema.index({ workspaceId: 1, key: 1 }, { unique: true });
exports.ContactSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" }, // as written
    phoneE164: { type: String, default: null }, // null when it can't be dialled
    email: String,
    groups: { type: [String], default: [] },
    fields: { type: Mixed, default: {} }, // typed values: number, boolean, "YYYY-MM-DD", string
    sourceId: String,
    lastCallAt: { type: Date, default: null },
    lastOutcome: { type: String, default: null },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
}, opts);
exports.ContactSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1, _id: -1 });
// One contact per number. A deleted contact gives its number up (phoneE164 set to null), like agents do.
exports.ContactSchema.index({ workspaceId: 1, phoneE164: 1 }, { unique: true, partialFilterExpression: { phoneE164: { $type: "string" } } });
exports.ContactSchema.index({ workspaceId: 1, groups: 1 });
// Any custom field, for filters and sorting at 100k+ contacts (compound wildcard, MongoDB 7).
exports.ContactSchema.index({ workspaceId: 1, "fields.$**": 1 });
exports.SourceSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true, index: true },
    kind: { type: String, enum: ["csv", "sync"], required: true },
    integrationId: String,
    name: String,
    object: String,
    list: String,
    fieldKeys: [String],
    rows: { type: Number, default: 0 },
    syncEvery: String,
    lastSyncAt: Date,
    status: { type: String, default: "synced" },
}, opts);
exports.ImportSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true, index: true },
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    fileName: String,
    csv: { type: String, required: true }, // up to ~15 MB; cleared when done
    columns: { type: Mixed, required: true },
    list: { type: String, default: "" },
    total: { type: Number, default: 0 },
    done: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    sourceId: String,
    error: String,
    createdBy: ObjectId,
}, opts);
// ---- Knowledge ----
exports.KnowledgeSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ["url", "sitemap", "site", "file", "text"], required: true },
    source: String,
    content: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },
    pages: Number,
    status: { type: String, enum: ["ready", "reading", "waiting", "failed"], default: "reading" },
    error: String,
    availableToAll: { type: Boolean, default: false },
    autoRefresh: Boolean,
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
}, opts);
exports.KnowledgeSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });
// ---- Campaigns ----
exports.CampaignSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true },
    config: { type: Mixed, required: true }, // CampaignInput (packages/core/src/schemas.ts)
    status: { type: String, enum: ["draft", "running", "paused", "done"], default: "draft" },
    called: { type: Number, default: 0 },
    answered: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
}, opts);
exports.CampaignSchema.index({ workspaceId: 1, deletedAt: 1, status: 1 });
// ---- Calls ----
exports.CallSchema = new mongoose_1.Schema({
    workspaceId: { type: ObjectId, required: true },
    contactId: { type: ObjectId, default: null }, // null: an unknown caller
    agentId: { type: ObjectId, required: true },
    agentVersionId: ObjectId,
    campaignId: ObjectId,
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    fromNumber: String,
    toNumber: String,
    startedAt: { type: Date, required: true },
    durationSec: { type: Number, default: 0 },
    outcome: { type: String, default: "" },
    summary: { type: String, default: "" },
    saved: { type: Mixed, default: {} },
    transcript: { type: [Mixed], default: [] },
    recording: Mixed,
    endReason: String,
    actions: [String],
    mood: [Number],
    feedback: { type: Mixed, default: null },
    checkResults: Mixed,
    live: { type: Boolean, default: false },
    lead: String,
    engagement: String,
    transferTo: String,
}, opts);
exports.CallSchema.index({ workspaceId: 1, startedAt: -1 });
exports.CallSchema.index({ workspaceId: 1, contactId: 1, startedAt: -1 });
exports.CallSchema.index({ workspaceId: 1, agentId: 1, startedAt: -1 });
exports.CallSchema.index({ campaignId: 1, startedAt: -1 }, { sparse: true });
// ---- Integrations ----
exports.IntegrationSchema = new mongoose_1.Schema({ workspaceId: { type: ObjectId, required: true }, providerId: { type: String, required: true }, connected: { type: Boolean, default: true }, account: String }, opts);
exports.IntegrationSchema.index({ workspaceId: 1, providerId: 1 }, { unique: true });
exports.MODELS = {
    User: exports.UserSchema,
    Session: exports.SessionSchema,
    LoginCode: exports.LoginCodeSchema,
    Workspace: exports.WorkspaceSchema,
    Membership: exports.MembershipSchema,
    Invite: exports.InviteSchema,
    Agent: exports.AgentSchema,
    AgentVersion: exports.AgentVersionSchema,
    PhoneNumber: exports.NumberSchema,
    FieldDef: exports.FieldDefSchema,
    Contact: exports.ContactSchema,
    Source: exports.SourceSchema,
    Import: exports.ImportSchema,
    Knowledge: exports.KnowledgeSchema,
    Campaign: exports.CampaignSchema,
    Call: exports.CallSchema,
    Integration: exports.IntegrationSchema,
};
//# sourceMappingURL=schemas.js.map