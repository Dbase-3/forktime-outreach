// Every collection the platform keeps (docs/PLATFORM_ROADMAP.md §5). Every
// workspace document carries workspaceId; editable ones carry `version` (for
// "someone else changed this" conflicts) and `deletedAt` (soft delete). The
// indexes enforce the rules the UI shows: one agent per number, one contact per
// number, unique field keys, one membership per person.

import { Schema, type InferSchemaType, type Types } from "mongoose";

const { ObjectId, Mixed } = Schema.Types;

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

const opts = { timestamps: true, minimize: false, versionKey: false } as const;

// ---- People and access ----

export const UserSchema = new Schema({ email: { type: String, required: true, unique: true }, name: { type: String, default: "" }, lastSignInAt: Date }, opts);

export const SessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: ObjectId, required: true, index: true },
    expiresAt: { type: Date, required: true },
    ip: String,
    userAgent: String,
  },
  opts,
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginCodeSchema = new Schema(
  { email: { type: String, required: true, index: true }, codeHash: { type: String, required: true }, expiresAt: { type: Date, required: true }, attempts: { type: Number, default: 0 }, ip: String },
  opts,
);
LoginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // kept an hour past expiry for rate limits

const SettingsShape = {
  businessName: { type: String, required: true },
  timezone: { type: String, default: "Australia/Sydney" },
  callingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
  callingStart: { type: Number, default: 9 },
  callingEnd: { type: Number, default: 19 },
  doNotCall: { type: [String], default: [] },
};

export const WorkspaceSchema = new Schema({ name: { type: String, required: true }, settings: SettingsShape, version: { type: Number, default: 1 }, createdBy: ObjectId }, opts);

export const MembershipSchema = new Schema({ workspaceId: { type: ObjectId, required: true }, userId: { type: ObjectId, required: true, index: true }, role: { type: String, enum: ROLES, required: true } }, opts);
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const InviteSchema = new Schema({ workspaceId: { type: ObjectId, required: true }, email: { type: String, required: true, index: true }, role: { type: String, enum: ROLES, required: true }, invitedBy: ObjectId, acceptedAt: Date }, opts);
InviteSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

// ---- Agents ----

export const AgentSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true },
    draft: { type: Mixed, required: true }, // AgentDraft (packages/core/src/schemas.ts)
    status: { type: String, enum: ["draft", "live"], default: "draft" },
    numberId: { type: ObjectId, default: null },
    publishedVersionId: { type: ObjectId, default: null },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
  },
  opts,
);
AgentSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });
// One agent per number. A deleted agent gives its number up (numberId unset), so it can't block.
AgentSchema.index({ numberId: 1 }, { unique: true, partialFilterExpression: { numberId: { $type: "objectId" } } });

export const AgentVersionSchema = new Schema(
  { workspaceId: { type: ObjectId, required: true }, agentId: { type: ObjectId, required: true }, n: { type: Number, required: true }, config: { type: Mixed, required: true }, publishedBy: ObjectId },
  opts,
);
AgentVersionSchema.index({ agentId: 1, n: 1 }, { unique: true });

// ---- Numbers ----

export const NumberSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true, index: true },
    e164: { type: String, required: true, unique: true },
    display: { type: String, required: true },
    country: { type: String, required: true },
    kind: { type: String, enum: ["local", "mobile", "tollfree"], required: true },
    area: String,
    provider: { type: String, default: "fake" }, // "telnyx" in Phase 3
    providerId: String,
    status: { type: String, enum: ["active", "releasing"], default: "active" },
  },
  opts,
);

// ---- Contacts ----

export const FieldDefSchema = new Schema(
  { workspaceId: { type: ObjectId, required: true }, key: { type: String, required: true }, label: { type: String, required: true }, type: { type: String, required: true }, choices: [String], source: String },
  opts,
);
FieldDefSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const ContactSchema = new Schema(
  {
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
  },
  opts,
);
ContactSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1, _id: -1 });
// One contact per number. A deleted contact gives its number up (phoneE164 set to null), like agents do.
ContactSchema.index({ workspaceId: 1, phoneE164: 1 }, { unique: true, partialFilterExpression: { phoneE164: { $type: "string" } } });
ContactSchema.index({ workspaceId: 1, groups: 1 });
// Any custom field, for filters and sorting at 100k+ contacts (compound wildcard, MongoDB 7).
ContactSchema.index({ workspaceId: 1, "fields.$**": 1 });

export const SourceSchema = new Schema(
  {
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
    skipped: { type: Number, default: 0 }, // a live sync: people left out (no number an agent can dial)
    lastError: String, // a live sync that failed: why, in words
  },
  opts,
);

export const ImportSchema = new Schema(
  {
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
    // Rows left out or partly read (first 5,000), with the file line and the row as it was, for the report.
    problems: { type: Mixed, default: [] }, // [{ line, reason, column?, value?, cells }]
    problemCount: { type: Number, default: 0 },
    header: { type: [String], default: [] },
    sourceId: String,
    error: String,
    createdBy: ObjectId,
  },
  opts,
);

// ---- Uploads waiting to be read (deleted once read; a day at most) ----

export const UploadSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true },
    docId: { type: ObjectId, required: true, index: true },
    name: String,
    data: { type: Buffer, required: true }, // ≤ 15 MB
    expiresAt: { type: Date, default: () => new Date(Date.now() + 86_400_000), expires: 0 },
  },
  opts,
);

// ---- Knowledge ----

export const KnowledgeSchema = new Schema(
  {
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
  },
  opts,
);
KnowledgeSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });

// Passages of each ready document, for search during calls (common/knowledge-index.ts).
// A text index for now; `embedding` is filled once the vector store is chosen (roadmap Phase 2).
export const KnowledgeChunkSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true },
    docId: { type: ObjectId, required: true },
    index: { type: Number, required: true },
    docName: { type: String, default: "" },
    heading: { type: String, default: "" },
    text: { type: String, required: true },
    embedding: { type: [Number], default: undefined },
  },
  { ...opts, timestamps: false },
);
KnowledgeChunkSchema.index({ docId: 1, index: 1 });
KnowledgeChunkSchema.index({ workspaceId: 1, docName: "text", heading: "text", text: "text" }, { weights: { docName: 2, heading: 3, text: 1 }, default_language: "english", name: "chunk_text" });

// ---- Campaigns ----

export const CampaignSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true },
    config: { type: Mixed, required: true }, // CampaignInput (packages/core/src/schemas.ts)
    status: { type: String, enum: ["draft", "running", "paused", "done"], default: "draft" },
    called: { type: Number, default: 0 },
    answered: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
  },
  opts,
);
CampaignSchema.index({ workspaceId: 1, deletedAt: 1, status: 1 });

// ---- Calls ----

export const CallSchema = new Schema(
  {
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
    bookingRefs: { type: [String], select: false }, // bookings this call found for the caller or made: the only ones it may move or cancel
    mood: [Number],
    feedback: { type: Mixed, default: null },
    checkResults: Mixed,
    live: { type: Boolean, default: false },
    lead: String,
    engagement: String,
    transferTo: String,
    // Voice runtime (Phase 2):
    test: { type: Boolean, default: false }, // the owner trying the agent from the editor
    config: Mixed, // a test call's agent draft, as it was when the call started
    path: [String], // the workflow steps the call walked
    missing: [String], // required answers it didn't get
  },
  opts,
);
CallSchema.index({ workspaceId: 1, startedAt: -1 });
CallSchema.index({ workspaceId: 1, contactId: 1, startedAt: -1 });
CallSchema.index({ workspaceId: 1, agentId: 1, startedAt: -1 });
CallSchema.index({ campaignId: 1, startedAt: -1 }, { sparse: true });

// ---- Integrations ----

export const IntegrationSchema = new Schema(
  {
    workspaceId: { type: ObjectId, required: true },
    providerId: { type: String, required: true },
    connected: { type: Boolean, default: true },
    account: String,
    secret: { type: String, select: false }, // the API key, sealed (common/secrets.ts); never sent anywhere
    accountId: String, // the provider's account the key is for (GHL: the sub-account / location id)
    hasKey: { type: Boolean, default: false }, // a key is stored: a keyed integration counts as connected only then
    eventType: { type: Mixed, default: null }, // a calendar: { id, name, minutes } calls book into
    lastError: String,
  },
  opts,
);
IntegrationSchema.index({ workspaceId: 1, providerId: 1 }, { unique: true });

export const MODELS = {
  User: UserSchema,
  Session: SessionSchema,
  LoginCode: LoginCodeSchema,
  Workspace: WorkspaceSchema,
  Membership: MembershipSchema,
  Invite: InviteSchema,
  Agent: AgentSchema,
  AgentVersion: AgentVersionSchema,
  PhoneNumber: NumberSchema,
  FieldDef: FieldDefSchema,
  Contact: ContactSchema,
  Source: SourceSchema,
  Import: ImportSchema,
  Knowledge: KnowledgeSchema,
  Upload: UploadSchema,
  KnowledgeChunk: KnowledgeChunkSchema,
  Campaign: CampaignSchema,
  Call: CallSchema,
  Integration: IntegrationSchema,
} as const;

export type ModelName = keyof typeof MODELS;
export type Doc<S extends Schema> = InferSchemaType<S> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
